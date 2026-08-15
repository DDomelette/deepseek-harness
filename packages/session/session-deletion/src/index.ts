/**
 * Recursive session-deletion orchestration (`ctx.sessionDeletion`). The
 * service owns running checks, descendant closure, leaf-to-root ordering,
 * already-gone resumption, and optional workspace/archive cleanup. It never
 * reaches into the runtime to cancel sessions; callers cancel first.
 * @module @deepseek-ai/dsh-session-deletion
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-workspace'

export type SessionDeletionErrorCode =
  | 'session-not-found'
  | 'session-running'
  | 'session-has-descendants'

export class SessionDeletionError extends Error {
  constructor(
    readonly code: SessionDeletionErrorCode,
    message: string,
    readonly runningSessionIds?: readonly SessionId[],
  ) {
    super(message)
    this.name = 'SessionDeletionError'
  }
}

export interface SessionDeletionInput {
  readonly sessionId: SessionId
  readonly recursive: boolean
}

export interface SessionDeletionResult {
  readonly deletedSessionIds: SessionId[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionDeletion: SessionDeletionService
  }
}

interface SessionIdentity {
  readonly parentSession: SessionId | undefined
}

/** Topological order leaves-first: repeatedly emit an id with no remaining children. */
function leavesFirst(
  ids: readonly SessionId[],
  children: ReadonlyMap<SessionId, readonly SessionId[]>,
): SessionId[] {
  const remaining = new Set(ids)
  const order: SessionId[] = []
  while (remaining.size > 0) {
    const leaf = [...remaining].find(id =>
      !(children.get(id) ?? []).some(child => remaining.has(child)))
    if (leaf === undefined) throw new Error('session lineage contains a cycle; refusing to delete')
    order.push(leaf)
    remaining.delete(leaf)
  }
  return order
}

/**
 * Recursive session-deletion service registered as `ctx.sessionDeletion`.
 */
export default class SessionDeletionService extends Service {
  static inject = ['sessions', 'sessionPersistence']

  constructor(ctx: Context) {
    super(ctx, 'sessionDeletion')
  }

  /**
   * Permanently delete one session and, when `recursive` is true, its
   * descendant subagent sessions leaves-first.
   * @param input - target and recursion switch.
   * @returns the ids durably deleted, in deletion order.
   */
  async delete(
    input: { readonly sessionId: SessionId; readonly recursive: boolean },
  ): Promise<{ readonly deletedSessionIds: SessionId[] }> {
    const { sessionId, recursive } = input
    const identities = new Map<SessionId, SessionIdentity>()
    const identityFor = (parentSession: SessionId | undefined): SessionIdentity => ({
      parentSession,
    })
    for (const session of this.ctx.sessions.list()) {
      const identity = identityFor(session.header.parentSession)
      identities.set(session.header.id, identity)
    }
    for (const meta of await this.ctx.sessionPersistence.list()) {
      identities.set(meta.id, identityFor(meta.parentSession))
    }
    if (!identities.has(sessionId)) {
      throw new SessionDeletionError('session-not-found', `session "${sessionId}" does not exist`)
    }

    const closure = new Set<SessionId>()
    const visit = (id: SessionId): void => {
      if (closure.has(id)) return
      closure.add(id)
      for (const [candidate, identity] of identities) {
        if (identity.parentSession === id) visit(candidate)
      }
    }
    visit(sessionId)
    const children = new Map<SessionId, SessionId[]>()
    for (const id of closure) {
      const parent = identities.get(id)?.parentSession
      if (parent === undefined || !closure.has(parent)) continue
      const siblings = children.get(parent) ?? []
      siblings.push(id)
      children.set(parent, siblings)
    }

    const running = [...closure].filter(id => this.ctx.sessions.get(id) !== undefined)
    if (running.length > 0) {
      throw new SessionDeletionError(
        'session-running',
        `cannot delete running session(s): ${running.join(', ')}`,
        running,
      )
    }
    if (!recursive && closure.size > 1) {
      throw new SessionDeletionError(
        'session-has-descendants',
        `session "${sessionId}" has descendant subagent sessions; pass recursive: true to delete them too`,
      )
    }

    const deletedSessionIds: SessionId[] = []
    for (const id of leavesFirst([...closure], children)) {
      try {
        await this.ctx.sessionPersistence.delete(id)
        deletedSessionIds.push(id)
      } catch (error) {
        if (error instanceof SessionPersistenceNotFoundError) continue
        throw error
      }
      const registry = this.ctx.get('workspaceRegistry')
      await registry?.forgetSession(id)
    }
    return { deletedSessionIds }
  }
}
