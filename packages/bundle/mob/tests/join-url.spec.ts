/**
 * The mob.joinUrl Remote method and its shared composer: the deployment's own
 * advertisement (`--public-url`, else its first `--trusted-host`) yields the
 * token-free origin a pairing link is built on; a deployment that declares
 * neither is a classified `mob/no-advertised-origin` failure.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { MobJoinController } from '../src/controller.ts'
import { resolveJoinUrl } from '../src/join-url.ts'

const LAN_URL = 'http://192.168.1.5:4567/'
const PUBLIC_URL = 'https://dsh.example.test/'

function bench(trustedHosts: string[], publicUrl?: string): Context {
  const ctx = new Context()
  ctx.provide('webStartup', { trustedHosts, ...(publicUrl === undefined ? {} : { publicUrl }) } as never)
  ctx.provide('webServer', { host: '0.0.0.0', port: 4567 } as never)
  return ctx
}

/** The classified failure of one joinUrl call. */
function failureOf(ctx: Context): unknown {
  try {
    new MobJoinController(ctx).joinUrl()
  } catch (error: unknown) {
    return error
  }
  throw new Error('joinUrl resolved where a failure was expected')
}

describe('resolveJoinUrl', () => {
  it('composes the origin from the first declared trusted host and the bound port', () => {
    expect(resolveJoinUrl(undefined, ['192.168.1.5'], 4567)).toBe(LAN_URL)
    expect(resolveJoinUrl(undefined, ['192.168.1.5'], 4567)).not.toContain('token')
  })

  it('prefers the advertised URL, normalizing a missing trailing slash', () => {
    expect(resolveJoinUrl(PUBLIC_URL, ['192.168.1.5'], 4567)).toBe(PUBLIC_URL)
    expect(resolveJoinUrl('https://dsh.example.test', [], 4567)).toBe(PUBLIC_URL)
  })

  it('returns undefined when the deployment declared neither', () => {
    expect(resolveJoinUrl(undefined, [], 4567)).toBeUndefined()
  })
})

describe('MobJoinController.joinUrl', () => {
  it('returns the origin the settings panel builds a pairing link on', () => {
    const ctx = bench(['192.168.1.5'])
    const controller = new MobJoinController(ctx)
    expect(controller.joinUrl()).toBe(LAN_URL)
  })

  it('returns the advertised URL when the deployment set one', () => {
    const ctx = bench(['192.168.1.5'], PUBLIC_URL)
    const controller = new MobJoinController(ctx)
    expect(controller.joinUrl()).toBe(PUBLIC_URL)
  })

  it('fails with mob/no-advertised-origin when the deployment declared neither', () => {
    expect(remoteErrorOf(failureOf(bench([]))))
      .toMatchObject({ code: 'mob/no-advertised-origin', details: {} })
  })
})
