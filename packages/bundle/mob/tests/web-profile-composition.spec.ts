/**
 * The phone-access layer over a real Loader tree: the row mounts the `mob`
 * Remote namespace, and its `joinUrl` reads the fence snapshot through the
 * injected services — LAN address, loopback-only bind, and an all-interfaces
 * bind that derived no reachable address.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { apply } from '../src/index.ts'
import type { MobJoinController } from '../src/controller.ts'

const LAN_URL = 'http://192.168.1.5:4567/?token=test-token'

const contexts: Context[] = []
const tempRoots: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  Reflect.deleteProperty(globalThis, '__dshMobApply')
  Reflect.deleteProperty(globalThis, '__dshMobWebRuntime')
  Reflect.deleteProperty(globalThis, '__dshMobRoutes')
})

interface BenchFacts {
  /** The bind host the webServer fixture reports. */
  host: string
  /** The fence snapshot the webRuntime fixture provides. */
  lanAddresses: string[]
}

/**
 * Boot a Loader tree of fixture rows plus the source-plane plugin.
 * @param facts - bind host and fence snapshot the fixtures report.
 * @returns the settled context holding the mounted `mob` namespace.
 */
async function bootTree(facts: BenchFacts): Promise<Context> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-mob-composition-'))
  tempRoots.push(root)
  writeFileSync(join(root, 'webserver.mjs'), `
export const apply = ctx => ctx.provide('webServer', {
  host: ${JSON.stringify(facts.host)},
  port: 4567,
  register(route) {
    globalThis.__dshMobRoutes.push(route.path)
    return () => { globalThis.__dshMobRoutes.splice(globalThis.__dshMobRoutes.indexOf(route.path), 1) }
  },
})
`)
  writeFileSync(join(root, 'runtime.mjs'), `
export const inject = ['webServer']
export const apply = ctx => ctx.provide('webRuntime', globalThis.__dshMobWebRuntime)
`)
  writeFileSync(join(root, 'connection.mjs'), `
export const inject = ['webServer']
export const apply = ctx => ctx.provide('connection', {
  authenticatedUrl(baseUrl) {
    const url = new URL(baseUrl)
    url.searchParams.set('token', 'test-token')
    return url.href
  },
  requestRejection: () => undefined,
  isLoopbackRequest: () => true,
  devices: {
    list: async () => [],
    register: async () => ({ id: 'device-1', label: 'phone', registeredAt: 1, lastSeenAt: 1 }),
    revoke: async () => true,
    touch: async () => true,
    issueCookie: () => 'dsh-auth-test=v2.body.signature',
  },
})
`)
  // Node imports the fixture row outside Vite's source resolver, so delegate
  // to the source-plane plugin already imported by this test.
  writeFileSync(join(root, 'mob.mjs'), `
export const name = 'mob-join'
export const inject = ['webServer', 'connection']
export const apply = ctx => globalThis.__dshMobApply(ctx)
`)
  writeFileSync(join(root, 'cordis.yml'), [
    '- id: webserver',
    `  name: ${pathToFileURL(join(root, 'webserver.mjs')).href}`,
    '- id: web-runtime',
    `  name: ${pathToFileURL(join(root, 'runtime.mjs')).href}`,
    '- id: connection',
    `  name: ${pathToFileURL(join(root, 'connection.mjs')).href}`,
    '- id: mob-join',
    `  name: ${pathToFileURL(join(root, 'mob.mjs')).href}`,
    '',
  ].join('\n'))

  const globals = globalThis as unknown as {
    __dshMobApply: typeof apply
    __dshMobWebRuntime: { lanAddresses: string[]; trustedHosts: string[] }
    __dshMobRoutes: string[]
  }
  globals.__dshMobApply = apply
  globals.__dshMobWebRuntime = { lanAddresses: facts.lanAddresses, trustedHosts: facts.lanAddresses }
  globals.__dshMobRoutes = []

  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(root, 'cordis.yml')).href } })
  await ctx.loader.await()
  return ctx
}

/** The mounted namespace, or a failed expectation when the row did not activate. */
function joinController(ctx: Context): MobJoinController {
  const controller = ctx.get('mobJoin') as MobJoinController | undefined
  expect(controller).toBeDefined()
  return controller as MobJoinController
}

/** The classified failure of one joinUrl call. */
function failureOf(ctx: Context): unknown {
  try {
    joinController(ctx).joinUrl()
  } catch (error: unknown) {
    return error
  }
  throw new Error('joinUrl resolved where a failure was expected')
}

describe('mob join namespace over a Loader tree', () => {
  it('returns the token-bearing LAN URL from the fence snapshot', async () => {
    const ctx = await bootTree({ host: '0.0.0.0', lanAddresses: ['192.168.1.5'] })
    expect(joinController(ctx).joinUrl()).toBe(LAN_URL)
  })

  it('classifies a loopback bind as mob/loopback-only', async () => {
    const ctx = await bootTree({ host: '127.0.0.1', lanAddresses: [] })
    expect(remoteErrorOf(failureOf(ctx))).toMatchObject({ code: 'mob/loopback-only', details: {} })
  })

  it('classifies an all-interfaces bind with no derived address as mob/no-lan-address', async () => {
    const ctx = await bootTree({ host: '0.0.0.0', lanAddresses: [] })
    expect(remoteErrorOf(failureOf(ctx))).toMatchObject({ code: 'mob/no-lan-address', details: {} })
  })

  it('registers every pairing route through the real Loader tree', async () => {
    await bootTree({ host: '127.0.0.1', lanAddresses: [] })
    const globals = globalThis as unknown as { __dshMobRoutes: string[] }
    expect([...globals.__dshMobRoutes].sort()).toEqual([
      '/pair', '/pair/approve', '/pair/devices', '/pair/requests', '/pair/revoke', '/pair/session', '/pair/state',
    ])
  })
})
