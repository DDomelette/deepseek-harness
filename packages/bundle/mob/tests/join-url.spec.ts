/**
 * The mob.joinUrl Remote method and its shared composer: the fence-fed LAN
 * snapshot yields the token-free LAN origin a pairing link is built on; a
 * loopback-only snapshot is a classified `mob/loopback-only` failure.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { MobJoinController } from '../src/controller.ts'
import { resolveJoinUrl } from '../src/join-url.ts'

const LAN_URL = 'http://192.168.1.5:4567/'

function bench(lanAddresses: string[], host = '0.0.0.0'): Context {
  const ctx = new Context()
  ctx.provide('webRuntime', { lanAddresses, trustedHosts: lanAddresses } as never)
  ctx.provide('webServer', { host, port: 4567 } as never)
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
  it('composes the LAN origin from the first literal and the bound port', () => {
    expect(resolveJoinUrl(['192.168.1.5'], 4567)).toBe(LAN_URL)
    expect(resolveJoinUrl(['192.168.1.5'], 4567)).not.toContain('token')
  })

  it('returns undefined on a loopback-only snapshot', () => {
    expect(resolveJoinUrl([], 4567)).toBeUndefined()
  })
})

describe('MobJoinController.joinUrl', () => {
  it('returns the LAN origin the settings panel builds a pairing link on', () => {
    const ctx = bench(['192.168.1.5'])
    const controller = new MobJoinController(ctx)
    expect(controller.joinUrl()).toBe(LAN_URL)
  })

  it('fails with mob/loopback-only when the deployment binds loopback', () => {
    expect(remoteErrorOf(failureOf(bench([], '127.0.0.1'))))
      .toMatchObject({ code: 'mob/loopback-only', details: {} })
  })

  it('separates an all-interfaces bind that derived no address from a loopback-only bind', () => {
    expect(remoteErrorOf(failureOf(bench([]))))
      .toMatchObject({ code: 'mob/no-lan-address', details: {} })
  })
})
