import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
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

interface Harness {
  ctx: Context
  deleted: string[]
  forget: ReturnType<typeof vi.fn>
}

async function harness(headers: SessionHeader[], live: string[] = []): Promise<Harness> {
  const ctx = new Context()
  const stored = new Map(headers.map(meta => [meta.id, meta]))
  const deleted: string[] = []
  ctx.provide('sessions', {
    list: () => live.map(id => ({ header: header(id) })),
    get: (id: SessionId) => live.includes(id) ? ({ id }) : undefined,
  } as never)
  ctx.provide('sessionPersistence', {
    list: async () => [...stored.values()],
    delete: async (id: SessionId) => {
      if (!stored.delete(id)) throw new SessionPersistenceNotFoundError(id)
      deleted.push(id)
    },
  } as never)
  const forget = vi.fn(async (_id: SessionId) => {})
  ctx.provide('workspaceRegistry', { forgetSession: forget } as never)
  await ctx.plugin(SessionDeletionService)
  return { ctx, deleted, forget }
}

describe('SessionDeletionService', () => {
  it('deletes leaves before roots and reports the bottom-up order', async () => {
    const { ctx, deleted } = await harness([
      header('root'),
      header('child', 'root'),
      header('leaf', 'child'),
    ])
    const result = await ctx.sessionDeletion.delete({ sessionId: SessionId('root'), recursive: true })
    expect(result.deletedSessionIds).toEqual(['leaf', 'child', 'root'])
    expect(deleted).toEqual(['leaf', 'child', 'root'])
  })

  it('refuses any attached cascade member with zero deletion', async () => {
    const { ctx, deleted } = await harness([
      header('root'),
      header('child', 'root'),
    ], ['child'])
    await expect(ctx.sessionDeletion.delete({ sessionId: SessionId('root'), recursive: true }))
      .rejects.toMatchObject({ code: 'session-running', runningSessionIds: ['child'] })
    expect(deleted).toEqual([])
  })

  it('refuses a non-recursive delete when descendants exist', async () => {
    const { ctx, deleted } = await harness([header('root'), header('child', 'root')])
    await expect(ctx.sessionDeletion.delete({ sessionId: SessionId('root'), recursive: false }))
      .rejects.toMatchObject({ code: 'session-has-descendants' })
    expect(deleted).toEqual([])
  })

  it('maps an unknown target to session-not-found', async () => {
    const { ctx } = await harness([])
    await expect(ctx.sessionDeletion.delete({ sessionId: SessionId('ghost'), recursive: true }))
      .rejects.toMatchObject({ code: 'session-not-found' })
  })

  it('skips already-gone cascade members and forgets each deleted id', async () => {
    const ctx = new Context()
    const stored = new Map<SessionId, SessionHeader>([
      [SessionId('root'), header('root')],
      [SessionId('child'), header('child', 'root')],
    ])
    stored.delete(SessionId('child'))
    ctx.provide('sessions', { list: () => [], get: () => undefined } as never)
    ctx.provide('sessionPersistence', {
      list: async () => [...stored.values()],
      delete: async (id: SessionId) => {
        if (id === SessionId('child')) throw new SessionPersistenceNotFoundError(id)
        stored.delete(id)
      },
    } as never)
    const forget = vi.fn(async (_id: SessionId) => {})
    ctx.provide('workspaceRegistry', { forgetSession: forget } as never)
    await ctx.plugin(SessionDeletionService)
    const result = await ctx.sessionDeletion.delete({ sessionId: SessionId('root'), recursive: true })
    expect(result.deletedSessionIds).toEqual(['root'])
    expect(forget.mock.calls.map(call => call[0])).toEqual(['root'])
  })
})
