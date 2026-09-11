/**
 * The QR announcer over a real Loader tree: the fence-fed LAN snapshot prints
 * a join line and QR after settlement; a loopback snapshot prints nothing.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'

vi.mock('qrcode-terminal', () => ({
  default: { generate: vi.fn() },
}))

import qrcode from 'qrcode-terminal'
import { apply } from '../src/index.ts'

const generate = vi.mocked(qrcode.generate)
const LAN_URL = 'http://192.168.1.5:4567/?token=test-token'
const originalIsTTY = process.stdout.isTTY

const contexts: Context[] = []
const tempRoots: string[] = []

beforeEach(() => {
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
})

afterEach(async () => {
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true })
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
  generate.mockReset()
  Reflect.deleteProperty(globalThis, '__dshMobApply')
  Reflect.deleteProperty(globalThis, '__dshMobWebRuntime')
})

/**
 * Boot a Loader tree of fixture rows plus the source-plane announcer.
 * @param lanAddresses - the webRuntime row's fence snapshot (empty on loopback).
 * @returns the console.log spy observed after Loader settlement.
 */
async function bootTree(lanAddresses: string[]): Promise<MockInstance<typeof console.log>> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-mob-composition-'))
  tempRoots.push(root)
  writeFileSync(join(root, 'webserver.mjs'), `
export const apply = ctx => ctx.provide('webServer', { host: '0.0.0.0', port: 4567 })
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
})
`)
  // Node imports the fixture row outside Vite's source resolver, so delegate
  // to the source-plane plugin already imported by this test.
  writeFileSync(join(root, 'mob.mjs'), `
export const name = 'mob-quick-join'
export const inject = ['webServer', 'webRuntime']
export const apply = ctx => globalThis.__dshMobApply(ctx)
`)
  writeFileSync(join(root, 'cordis.yml'), [
    '- id: webserver',
    `  name: ${pathToFileURL(join(root, 'webserver.mjs')).href}`,
    '- id: web-runtime',
    `  name: ${pathToFileURL(join(root, 'runtime.mjs')).href}`,
    '- id: connection',
    `  name: ${pathToFileURL(join(root, 'connection.mjs')).href}`,
    '- id: mob-quick-join',
    `  name: ${pathToFileURL(join(root, 'mob.mjs')).href}`,
    '',
  ].join('\n'))

  const globals = globalThis as unknown as {
    __dshMobApply: typeof apply
    __dshMobWebRuntime: { lanAddresses: string[]; trustedHosts: string[] }
  }
  globals.__dshMobApply = apply
  globals.__dshMobWebRuntime = { lanAddresses, trustedHosts: lanAddresses }

  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(root, 'cordis.yml')).href } })
  await ctx.loader.await()
  return log
}

describe('mob QR announcer composition', () => {
  it('prints the join line and QR after the Loader tree settles', async () => {
    const log = await bootTree(['192.168.1.5'])
    expect(log).toHaveBeenCalledWith(`dsh mob: scan to join from this network: ${LAN_URL}`)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate).toHaveBeenCalledWith(LAN_URL, { small: true })
  })

  it('prints nothing when the fence snapshot has no LAN address', async () => {
    const log = await bootTree([])
    expect(log).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
  })
})
