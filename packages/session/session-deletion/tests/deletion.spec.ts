import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import SessionDeletionService from '@deepseek-ai/dsh-session-deletion'

function header(id: string, parent?: string): SessionHeader {
  return {
    version: 1,
    id: SessionId(id),
    createdAt: 1000,
    cwd: '/work',
    ...parent === undefined ? {} : { parentSession: SessionId(parent) },
  }
}

interface HarnessOptions {
  pool?: MemoryMediaPool
  headers?: SessionHeader[]
  live?: string[]
  persistenceDelete?: (id: SessionId) => Promise<void>
  forgetSession?: (id: SessionId) => Promise<void>
}

async function harness(options: HarnessOptions = {}) {
  const ctx = new Context()
  const pool = options.pool ?? new MemoryMediaPool()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)

  const headers = options.headers ?? []
  const stored = new Map(headers.map(meta => [meta.id, meta]))
  const deleted: string[] = []
  ctx.provide('sessions', {
    list: () => (options.live ?? []).map(id => ({ header: header(id) })),
    get: (id: SessionId) => (options.live ?? []).includes(id) ? ({ id }) : undefined,
  } as never)
  ctx.provide('sessionPersistence', {
    list: async () => [...stored.values()],
    delete: options.persistenceDelete ?? (async (id: SessionId) => {
      if (!stored.delete(id)) throw new SessionPersistenceNotFoundError(id)
      deleted.push(id)
    }),
  } as never)
  const forget = vi.fn(options.forgetSession ?? (async (_id: SessionId) => {}))
  ctx.provide('workspaceRegistry', { forgetSession: forget } as never)
  const fiber = await ctx.plugin(SessionDeletionService)
  return { ctx, pool, deleted, forget, stored, fiber }
}

describe('SessionDeletionService', () => {
  it('deletes leaves before roots and reports the bottom-up order', async () => {
    const { ctx, deleted } = await harness({
      headers: [header('root'), header('child', 'root'), header('leaf', 'child')],
    })
    const result = await ctx.sessionDeletion.delete({ sessionId: SessionId('root'), recursive: true })
    expect(result.deletedSessionIds).toEqual(['leaf', 'child', 'root'])
    expect(deleted).toEqual(['leaf', 'child', 'root'])
  })

  it('refuses any attached cascade member with zero deletion', async () => {
    const { ctx, deleted } = await harness({
      headers: [header('root'), header('child', 'root')],
      live: ['child'],
    })
    await expect(ctx.sessionDeletion.delete({ sessionId: SessionId('root'), recursive: true }))
      .rejects.toMatchObject({ code: 'session-running', runningSessionIds: ['child'] })
    expect(deleted).toEqual([])
  })

  it('refuses a non-recursive delete when descendants exist', async () => {
    const { ctx, deleted } = await harness({ headers: [header('root'), header('child', 'root')] })
    await expect(ctx.sessionDeletion.delete({ sessionId: SessionId('root'), recursive: false }))
      .rejects.toMatchObject({ code: 'session-has-descendants' })
    expect(deleted).toEqual([])
  })

  it('maps an unknown target to session-not-found', async () => {
    const { ctx } = await harness()
    await expect(ctx.sessionDeletion.delete({ sessionId: SessionId('ghost'), recursive: true }))
      .rejects.toMatchObject({ code: 'session-not-found' })
  })

  it('forgets members that are already gone by execution time, then clears the plan', async () => {
    const { ctx, deleted, forget, pool } = await harness({
      headers: [header('root'), header('child', 'root')],
      persistenceDelete: async (id) => {
        if (id === SessionId('child')) throw new SessionPersistenceNotFoundError(id)
        deleted.push(id)
      },
    })
    const result = await ctx.sessionDeletion.delete({ sessionId: SessionId('root'), recursive: true })
    expect(result.deletedSessionIds).toEqual(['child', 'root'])
    expect(forget.mock.calls.map(call => call[0])).toEqual(['child', 'root'])
    const planMedium = pool.media.get('session_deletion')
    expect(planMedium?.tables.get('plans')?.size).toBe(0)
  })

  it('retries workspace cleanup from the durable plan after a mid-cascade failure', async () => {
    const pool = new MemoryMediaPool()
    let leafForgetAttempts = 0
    const first = await harness({
      pool,
      headers: [header('root'), header('child', 'root'), header('leaf', 'child')],
      forgetSession: async (id) => {
        if (id === SessionId('leaf') && leafForgetAttempts++ === 0) {
          throw new Error('workspace write down')
        }
      },
    })
    await expect(first.ctx.sessionDeletion.delete({ sessionId: SessionId('root'), recursive: true }))
      .rejects.toThrow(/workspace write down/)
    // Leaf persistence is done and durably marked; root/child remain pending.
    const planMedium = first.pool.media.get('session_deletion')
    const plan = planMedium?.tables.get('plans')?.get('root') as { members: Array<{ sessionId: string; persistence: string }> } | undefined
    expect(plan).toBeDefined()
    expect(plan?.members.find(member => member.sessionId === 'leaf')?.persistence).toBe('done')

    await first.fiber.dispose()
    const second = await harness({
      pool,
      headers: [header('root'), header('child', 'root')],
    })
    const result = await second.ctx.sessionDeletion.delete({ sessionId: SessionId('root'), recursive: true })
    expect(result.deletedSessionIds).toEqual(['leaf', 'child', 'root'])
    expect(second.deleted).toEqual(['child', 'root'])
    expect(second.forget.mock.calls.map(call => call[0])).toEqual(['leaf', 'child', 'root'])
    expect(second.pool.media.get('session_deletion')?.tables.get('plans')?.size).toBe(0)
  })

  it('rolls back a session/created while its id is in an active deletion plan', async () => {
    const ctx = new Context()
    const pool = new MemoryMediaPool()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    await ctx.plugin(SessionStore)

    let releaseDelete: (() => void) | undefined
    const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve })
    let deleteStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => { deleteStarted = resolve })
    ctx.provide('sessionPersistence', {
      list: async () => [header('root')],
      delete: async (_id: SessionId) => {
        deleteStarted?.()
        await deleteGate
      },
    } as never)
    const forget = vi.fn(async (_id: SessionId) => {})
    ctx.provide('workspaceRegistry', { forgetSession: forget } as never)
    await ctx.plugin(SessionDeletionService)

    const pending = ctx.sessionDeletion.delete({ sessionId: SessionId('root'), recursive: true })
    await started
    expect(() => ctx.sessions.create(SessionId('root'))).toThrow(/while it is being deleted/)
    releaseDelete?.()
    await expect(pending).resolves.toEqual({ deletedSessionIds: ['root'] })
  })
})
