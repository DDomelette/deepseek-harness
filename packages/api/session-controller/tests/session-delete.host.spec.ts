/**
 * Session Controller recursive-deletion delegation. The optional
 * `ctx.sessionDeletion` service owns the durable plan, persistence cleanup, and
 * workspace accounting, so these cases pin the Remote error mapping and the
 * unary value; `dsh-session-deletion`'s own spec owns the orchestration, and the
 * Web e2e scenario owns one real browser-driven deletion.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { SessionDeletionError } from '@deepseek-ai/dsh-session-deletion'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { createSessionTestRemote } from './test-remote.ts'

const sid = (id: string): SessionId => id as SessionId

/** Provide one structural `sessionDeletion` service over the shared store. */
function provideDeletion(
  ctx: Context,
  deleteSessions: (input: { sessionId: SessionId; recursive: boolean }) => Promise<{ deletedSessionIds: SessionId[] }>,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn(deleteSessions)
  ctx.provide('sessionDeletion', { delete: spy } as never)
  return spy
}

async function composed(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  return ctx
}

const remote = (ctx: Context) => createSessionTestRemote(ctx, {
  defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
  cwd: '/tmp',
})

describe('sessions.delete', () => {
  it('reports an unmounted deletion service instead of a transport failure', async () => {
    const ctx = await composed()
    const response = await remote(ctx).delete({ sessionId: sid('anything') })
    expect(response.ok).toBe(false)
    if (response.ok) return
    expect(response.error.code).toBe('session/deletion-unavailable')
    expect(response.error.message).toMatch(/does not mount @deepseek-ai\/dsh-session-deletion/)
  })

  it('deletes recursively by default only when asked and returns every removed identity', async () => {
    const ctx = await composed()
    const spy = provideDeletion(ctx, () => Promise.resolve({
      deletedSessionIds: [sid('child'), sid('root')],
    }))

    const response = await remote(ctx).delete({ sessionId: sid('root'), recursive: true })
    expect(response.ok).toBe(true)
    if (response.ok) expect(response.value).toEqual({ deletedSessionIds: [sid('child'), sid('root')] })
    expect(spy).toHaveBeenCalledWith({ sessionId: sid('root'), recursive: true })

    await remote(ctx).delete({ sessionId: sid('root') })
    expect(spy).toHaveBeenLastCalledWith({ sessionId: sid('root'), recursive: false })
  })

  it.each([
    { label: 'reported running identities', runningSessionIds: [sid('root')], expected: [sid('root')] },
    { label: 'no optional identities', runningSessionIds: undefined, expected: [] },
  ])('maps an attached Session to session/running with $label', async ({ runningSessionIds, expected }) => {
    const ctx = await composed()
    provideDeletion(ctx, () => Promise.reject(
      new SessionDeletionError('session-running', 'session root is still attached', runningSessionIds),
    ))
    const response = await remote(ctx).delete({ sessionId: sid('root'), recursive: true })
    expect(response.ok).toBe(false)
    if (response.ok) return
    expect(response.error).toMatchObject({
      code: 'session/running',
      details: { runningSessionIds: expected },
    })
  })

  it('maps a non-recursive request with descendants to session/has-descendants', async () => {
    const ctx = await composed()
    provideDeletion(ctx, () => Promise.reject(
      new SessionDeletionError('session-has-descendants', 'session root has subagent descendants'),
    ))
    const response = await remote(ctx).delete({ sessionId: sid('root') })
    expect(response.ok).toBe(false)
    if (response.ok) return
    expect(response.error).toMatchObject({
      code: 'session/has-descendants',
      details: { sessionId: sid('root') },
    })
  })

  it('maps a missing Session to session/not-found', async () => {
    const ctx = await composed()
    provideDeletion(ctx, () => Promise.reject(
      new SessionDeletionError('session-not-found', 'session ghost does not exist'),
    ))
    const response = await remote(ctx).delete({ sessionId: sid('ghost'), recursive: true })
    expect(response.ok).toBe(false)
    if (response.ok) return
    expect(response.error).toMatchObject({
      code: 'session/not-found',
      details: { sessionId: sid('ghost') },
    })
  })

  it('does not disguise an unrelated storage failure as a business refusal', async () => {
    const ctx = await composed()
    provideDeletion(ctx, () => Promise.reject(new Error('storage unavailable')))
    const response = await remote(ctx).delete({ sessionId: sid('root'), recursive: true })
    expect(response.ok).toBe(false)
    if (response.ok) return
    expect(response.error.code).toBe('gateway/internal')
  })
})
