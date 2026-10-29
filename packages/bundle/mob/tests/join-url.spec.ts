/** The token-free phone URL follows the advertised authority or the concrete listener. */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { MobJoinController } from '../src/controller.ts'
import { resolveJoinUrl } from '../src/join-url.ts'

const LAN_URL = 'http://192.168.1.5:4567/'
const PUBLIC_URL = 'https://dsh.example.test/'
const listener = { host: '192.168.1.5', port: 4567, protocol: 'http:' } as const
const loopback = { ...listener, host: '127.0.0.1' }

function bench(trustedHosts: string[], publicUrl?: string): Context {
  const ctx = new Context()
  ctx.provide('webStartup', { trustedHosts, ...(publicUrl === undefined ? {} : { publicUrl }) } as never)
  ctx.provide('webServer', loopback as never)
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
  it('uses the first declared authority with its explicit port or the bound port', () => {
    expect(resolveJoinUrl(undefined, ['192.168.1.5', 'other.example'], loopback)).toBe(LAN_URL)
    expect(resolveJoinUrl(undefined, ['dsh.example:8080'], listener)).toBe('http://dsh.example:8080/')
    expect(resolveJoinUrl(undefined, ['dsh.example:80'], listener)).toBe('http://dsh.example/')
    expect(resolveJoinUrl(undefined, ['[2001:db8::5]:8443'], { ...listener, protocol: 'https:' }))
      .toBe('https://[2001:db8::5]:8443/')
    expect(resolveJoinUrl(undefined, ['[2001:db8::5]'], listener)).toBe('http://[2001:db8::5]:4567/')
    expect(resolveJoinUrl(undefined, ['dsh.example:443'], { ...listener, protocol: 'https:' }))
      .toBe('https://dsh.example/')
  })

  it('prefers the advertised URL and preserves its proxy path', () => {
    expect(resolveJoinUrl(PUBLIC_URL, ['192.168.1.5'], listener)).toBe(PUBLIC_URL)
    expect(resolveJoinUrl('https://dsh.example.test/tools/dsh', [], listener))
      .toBe('https://dsh.example.test/tools/dsh/')
  })

  it('uses the concrete non-loopback bind with its transport and IPv6 brackets', () => {
    expect(resolveJoinUrl(undefined, [], listener)).toBe(LAN_URL)
    expect(resolveJoinUrl(undefined, [], { ...listener, protocol: 'https:' })).toBe('https://192.168.1.5:4567/')
    expect(resolveJoinUrl(undefined, [], { ...listener, host: '2001:db8::5' }))
      .toBe('http://[2001:db8::5]:4567/')
  })

  it('requires an advertised authority for loopback and zoned non-loopback binds', () => {
    for (const host of ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'fe80::5%eth0']) {
      expect(resolveJoinUrl(undefined, [], { ...listener, host })).toBeUndefined()
    }
  })
})

describe('MobJoinController.joinUrl', () => {
  it('returns the declared authority or advertised URL without a process token', () => {
    expect(new MobJoinController(bench(['192.168.1.5'])).joinUrl()).toBe(LAN_URL)
    expect(new MobJoinController(bench(['192.168.1.5'], PUBLIC_URL)).joinUrl()).toBe(PUBLIC_URL)
  })

  it('fails with mob/no-advertised-origin when no phone address is configured', () => {
    expect(remoteErrorOf(failureOf(bench([]))))
      .toMatchObject({ code: 'mob/no-advertised-origin', details: {} })
  })
})
