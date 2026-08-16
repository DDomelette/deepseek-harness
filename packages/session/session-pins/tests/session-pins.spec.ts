import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import SessionFlagRegistry from '../../session-flags/src/index.ts'
import SessionPinsService, { SessionPinsInvalidError } from '../src/index.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

async function boot(pool = new MemoryMediaPool()) {
  ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(SessionFlagRegistry)
  await ctx.plugin(SessionPinsService)
  return { ctx, pool }
}

describe('session pins service', () => {
  it('pins, persists, and unpins back to the original order', async () => {
    const { ctx: loaded, pool } = await boot()
    expect(loaded.sessionPins.list()).toEqual({ pinnedSessionIds: [], groupOrder: {}, flatOrder: [] })

    const pinned = await loaded.sessionPins.setPinned({ sessionId: 's1', pinned: true })
    expect(pinned.pinnedSessionIds).toEqual([SessionId('s1')])

    await loaded.fiber.dispose()
    ctx = undefined
    const reloaded = await boot(pool)
    expect(reloaded.ctx.sessionPins.list().pinnedSessionIds).toEqual([SessionId('s1')])

    const unpinned = await reloaded.ctx.sessionPins.setPinned({ sessionId: 's1', pinned: false })
    expect(unpinned.pinnedSessionIds).toEqual([])
  })

  it('rejects reorder ids that are not currently pinned', async () => {
    const { ctx: loaded } = await boot()
    await expect(loaded.sessionPins.reorderGroup({ groupKey: '', orderedIds: ['ghost'] }))
      .rejects.toBeInstanceOf(SessionPinsInvalidError)
  })

  it('stores and returns group and flat order overrides', async () => {
    const { ctx: loaded } = await boot()
    await loaded.sessionPins.setPinned({ sessionId: 's1', pinned: true })
    await loaded.sessionPins.setPinned({ sessionId: 's2', pinned: true })
    const grouped = await loaded.sessionPins.reorderGroup({ groupKey: 'ws', orderedIds: ['s2', 's1'] })
    expect(grouped.groupOrder.ws).toEqual([SessionId('s2'), SessionId('s1')])
    const flat = await loaded.sessionPins.reorderFlat({ orderedIds: ['s2', 's1'] })
    expect(flat.flatOrder).toEqual([SessionId('s2'), SessionId('s1')])
  })

  it('serializes concurrent mutations without losing pins', async () => {
    const { ctx: loaded } = await boot()
    await Promise.all([
      loaded.sessionPins.setPinned({ sessionId: 's1', pinned: true }),
      loaded.sessionPins.setPinned({ sessionId: 's2', pinned: true }),
      loaded.sessionPins.setPinned({ sessionId: 's3', pinned: true }),
    ])
    expect(loaded.sessionPins.list().pinnedSessionIds).toEqual([
      SessionId('s1'), SessionId('s2'), SessionId('s3'),
    ])
  })
})
