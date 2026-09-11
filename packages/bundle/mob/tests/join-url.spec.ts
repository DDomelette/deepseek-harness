/**
 * The mob.joinUrl Remote method and its shared URL composer: the fence-fed LAN
 * snapshot yields the token-bearing join URL; a loopback-only snapshot is a
 * classified `mob/loopback-only` failure.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { MobJoinController } from '../src/controller.ts'
import { resolveJoinUrl } from '../src/join-url.ts'

const LAN_URL = 'http://192.168.1.5:4567/?token=test-token'

function authenticatedUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.searchParams.set('token', 'test-token')
  return url.href
}

function bench(lanAddresses: string[]): Context {
  const ctx = new Context()
  ctx.provide('connection', { authenticatedUrl } as never)
  ctx.provide('webRuntime', { lanAddresses, trustedHosts: lanAddresses } as never)
  ctx.provide('webServer', { host: '0.0.0.0', port: 4567 } as never)
  return ctx
}

describe('resolveJoinUrl', () => {
  it('composes the token-bearing URL from the first LAN literal and the bound port', () => {
    expect(resolveJoinUrl(['192.168.1.5'], 4567, authenticatedUrl)).toBe(LAN_URL)
  })

  it('returns undefined on a loopback-only snapshot without touching the token builder', () => {
    const fail = (): string => { throw new Error('must not authenticate a loopback-only deployment') }
    expect(resolveJoinUrl([], 4567, fail)).toBeUndefined()
  })
})

describe('MobJoinController.joinUrl', () => {
  it('returns the same URL the terminal announcer prints', () => {
    const ctx = bench(['192.168.1.5'])
    const controller = new MobJoinController(ctx)
    expect(controller.joinUrl()).toBe(LAN_URL)
  })

  it('fails with mob/loopback-only when the fence snapshot has no LAN address', () => {
    const ctx = bench([])
    const controller = new MobJoinController(ctx)
    const failure = (() => {
      try {
        controller.joinUrl()
      } catch (error: unknown) {
        return error
      }
    })()
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'mob/loopback-only', details: {} })
  })
})
