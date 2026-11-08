/**
 * The Remote assembly reserves Host administration for the operator: the
 * settings write endpoints refuse a paired device at the transport, so a phone
 * that authenticates the use of the agent cannot change configuration.
 */

import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/index.ts'

interface Bench {
  readonly ctx: Context
  readonly fiber: Fiber
  /** Endpoints the assembly reserved, in registration order. */
  readonly reserved: string[]
  /** Endpoints whose reservation was released on disposal. */
  readonly released: string[]
}

/**
 * Mount the assembly with a Gateway and a Connection double.
 * @returns the reserved and released endpoint names.
 */
function bench(): Bench {
  const ctx = new Context()
  const reserved: string[] = []
  const released: string[] = []
  ctx.reflect.provide('typertGateway', {
    registerRemoteEvents: () => async () => {},
  })
  ctx.reflect.provide('connection', {
    reserveOperatorOnly(endpoint: string) {
      reserved.push(endpoint)
      return () => { released.push(endpoint) }
    },
  })
  const fiber = ctx.plugin({ inject: [...inject], apply })
  return { ctx, fiber, reserved, released }
}

describe('operator-only Remote endpoints', () => {
  it('reserves every settings write and releases the reservations on disposal', async () => {
    const subject = bench()
    await subject.fiber.await()
    await vi.waitFor(() => {
      expect(subject.reserved).toEqual([
        'settings/update',
        'settings/replace',
        'settings/mutate',
        'settings/openSettingsDocument',
      ])
    })

    // Disposal proves the reservation is an effect, not a process-lifetime flag.
    await subject.fiber.dispose()
    expect(subject.released.sort()).toEqual([...subject.reserved].sort())
  })
})
