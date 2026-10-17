/**
 * Session Controller deletion over the real recursive-deletion service.
 *
 * `session-delete.host.spec.ts` pins the Remote error mapping against a
 * structural service; this file proves the wiring the merged tree lost: a
 * mounted `dsh-session-deletion` behind `session.delete` derives one complete
 * plan, removes every generation oldest-first, and cleans the Workspace account
 * of each member.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SessionDeletionService from '@deepseek-ai/dsh-session-deletion'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { createSessionTestRemote } from './test-remote.ts'

const roots: Context[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

function header(id: string, parent?: string): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    isSeeded: false,
    id: SessionId(id),
    createdAt: 1000,
    cwd: '/work',
    ...parent === undefined ? {} : { parentSession: SessionId(parent) },
  }
}

/** Compose the controller's own services plus the real deletion orchestrator. */
async function harness(headers: readonly SessionHeader[]) {
  const ctx = new Context()
  roots.push(ctx)
  const pool = new MemoryMediaPool()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)

  const stored = new Map(headers.map(meta => [meta.id, meta]))
  const deleted: SessionId[] = []
  ctx.provide('sessionPersistence', {
    list: async () => [...stored.values()].map(header => ({ header, asOfSeq: 0 })),
    delete: async (id: SessionId) => {
      stored.delete(id)
      deleted.push(id)
    },
  } as never)
  const forgotten: SessionId[] = []
  ctx.provide('workspaceRegistry', {
    archivedSessionIds: [],
    pinnedSessionIds: [],
    list: () => [],
    forgetSession: vi.fn(async (id: SessionId) => { forgotten.push(id) }),
  } as never)
  await ctx.plugin(SessionDeletionService)
  return { ctx, stored, deleted, forgotten }
}

const remote = (ctx: Context) => createSessionTestRemote(ctx, {
  defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
  cwd: '/work',
})

describe('session.delete over the recursive-deletion service', () => {
  it('removes a parent, its child, and their workspace account in one recursive request', async () => {
    const h = await harness([header('root'), header('child', 'root'), header('unrelated')])

    const response = await remote(h.ctx).delete({ sessionId: SessionId('root'), recursive: true })

    expect(response.ok).toBe(true)
    if (response.ok) {
      expect([...response.value.deletedSessionIds].sort()).toEqual(['child', 'root'])
    }
    expect(h.deleted.slice().sort()).toEqual(['child', 'root'])
    // Leaves first: the child generation is removed before its parent.
    expect(h.deleted[0]).toBe(SessionId('child'))
    expect(h.forgotten.slice().sort()).toEqual(['child', 'root'])
    expect([...h.stored.keys()]).toEqual([SessionId('unrelated')])
  })

  it('refuses a non-recursive request that would orphan the child', async () => {
    const h = await harness([header('root'), header('child', 'root')])

    const response = await remote(h.ctx).delete({ sessionId: SessionId('root') })

    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error.code).toBe('session/has-descendants')
    expect(h.deleted).toEqual([])
    expect(h.stored.size).toBe(2)
  })

  it('answers session/not-found for an unknown Session without creating a plan', async () => {
    const h = await harness([])

    const response = await remote(h.ctx).delete({ sessionId: SessionId('ghost'), recursive: true })

    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error.code).toBe('session/not-found')
    expect(h.deleted).toEqual([])
  })
})
