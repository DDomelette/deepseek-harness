import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionFlagRegistry, { type SessionFlagProvider } from '../src/index.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

async function harness(providers: SessionFlagProvider[]) {
  ctx = new Context()
  await ctx.plugin(SessionFlagRegistry)
  for (const provider of providers) ctx.sessionFlags.registerProvider(provider)
  return ctx.sessionFlags
}

describe('session flags registry', () => {
  it('merges providers with later providers winning per session key', async () => {
    const registry = await harness([
      { id: 'a', list: () => ({ [SessionId('s1')]: { pinned: true } }) },
      { id: 'b', list: () => ({ [SessionId('s1')]: { pinned: false }, [SessionId('s2')]: { pinned: true } }) },
    ])
    expect(registry.snapshot()).toEqual({
      flags: {
        [SessionId('s1')]: { pinned: false },
        [SessionId('s2')]: { pinned: true },
      },
      complete: true,
    })
  })

  it('keeps the last good snapshot when a provider fails and removes providers on dispose', async () => {
    const failing: SessionFlagProvider = { id: 'failing', list: () => { throw new Error('boom') } }
    const registry = await harness([
      { id: 'ok', list: () => ({ [SessionId('s1')]: { pinned: true } }) },
    ])
    const dispose = registry.registerProvider(failing)
    expect(registry.snapshot()).toEqual({
      flags: { [SessionId('s1')]: { pinned: true } },
      complete: false,
    })
    dispose()
    expect(registry.snapshot()).toEqual({
      flags: { [SessionId('s1')]: { pinned: true } },
      complete: true,
    })
  })
})
