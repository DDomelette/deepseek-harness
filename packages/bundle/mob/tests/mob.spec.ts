/**
 * The bundle's host half: mounting the plugin registers the `mob` Remote
 * namespace (once its injected services exist) and writes nothing to the
 * terminal; disposing its fiber withdraws the namespace again.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, name } from '../src/index.ts'

const contexts: Context[] = []

/** The services `MobJoinController` injects; only their presence matters here. */
function provideInjected(ctx: Context): void {
  ctx.provide('webServer', { host: '0.0.0.0', port: 4567, register: () => () => {} } as never)
  ctx.provide('webRuntime', { lanAddresses: ['192.168.1.5'], trustedHosts: ['192.168.1.5'] } as never)
  ctx.provide('connection', {
    authenticatedUrl(baseUrl: string) {
      const url = new URL(baseUrl)
      url.searchParams.set('token', 'test-token')
      return url.href
    },
    requestRejection: () => undefined,
    isLocalOperatorRequest: () => true,
    devices: {
      list: async () => [],
      register: async () => ({ id: 'device-1', label: 'phone', registeredAt: 1, lastSeenAt: 1 }),
      revoke: async () => true,
      touch: async () => true,
      issueCookie: () => 'dsh-auth-test=v2.body.signature',
    },
  } as never)
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.restoreAllMocks()
})

describe('mob bundle host half', () => {
  it('registers the mob Remote namespace and prints nothing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctx = new Context()
    contexts.push(ctx)
    provideInjected(ctx)

    apply(ctx)
    await vi.waitFor(() => { expect(ctx.get('mobJoin')).toBeDefined() })

    expect(name).toBe('mob-join')
    expect(log).not.toHaveBeenCalled()
    expect(diagnostic).not.toHaveBeenCalled()
  })

  it('withdraws the namespace when its own fiber is disposed', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    provideInjected(ctx)

    const fiber = ctx.plugin({ name, apply })
    await fiber
    expect(ctx.get('mobJoin')).toBeDefined()

    await fiber.dispose()
    expect(ctx.get('mobJoin')).toBeUndefined()
  })
})
