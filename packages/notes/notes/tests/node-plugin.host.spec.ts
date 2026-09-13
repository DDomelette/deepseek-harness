/**
 * The notes node half: the entry activates on a bare context, contributes
 * nothing yet, and releases its Loader seat on dispose.
 */
import { Context, FiberState } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

describe('notes node half', () => {
  it('activates as an inert Loader seat and unregisters on dispose', async () => {
    ctx = new Context()
    const plugin = { apply }
    expect(ctx.registry.has(plugin)).toBe(false)
    const fiber = ctx.plugin(plugin)
    await fiber.await()
    expect(fiber.state).toBe(FiberState.ACTIVE)
    // The empty apply contributes no effect yet, so the fiber owns nothing.
    expect(fiber.getEffects()).toEqual([])
    expect(ctx.registry.has(plugin)).toBe(true)
    await fiber.dispose()
    expect(fiber.state).toBe(FiberState.DISPOSED)
    // Disposal leaves no registration behind for the next mount to inherit.
    expect(ctx.registry.has(plugin)).toBe(false)
  })
})
