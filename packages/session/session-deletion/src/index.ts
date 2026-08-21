/**
 * Recursive session-deletion orchestration (`ctx.sessionDeletion`). The
 * service persists a complete deletion plan before the first destructive
 * write, then advances per-member persistence and workspace cleanup steps.
 * Retries load the plan instead of re-deriving lineage from remaining logs.
 * It never cancels running sessions; callers cancel first.
 * @module @deepseek-ai/dsh-session-deletion
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-workspace'
import { deletionDomainSpec, type DeletionPlanRecord } from './spec.ts'

/** Closed failure codes callers can map to transport-specific errors. */
export type SessionDeletionErrorCode =
  | 'session-not-found'
  | 'session-running'
  | 'session-has-descendants'

/** Domain error raised when a requested session deletion cannot start. */
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

/** Target and descendant policy for one deletion request. */
export interface SessionDeletionInput {
  readonly sessionId: SessionId
  readonly recursive: boolean
}

/** Sessions permanently removed by one completed deletion plan. */
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

/** A cross-package duplicate of the seam error is still recognizable by shape. */
function isNotFound(error: unknown): boolean {
  return error instanceof SessionPersistenceNotFoundError
    || (error instanceof Error && error.name === 'SessionPersistenceNotFoundError')
}

/**
 * Recursive session-deletion service registered as `ctx.sessionDeletion`.
 */
export default class SessionDeletionService extends Service {
  static inject = ['sessions', 'sessionPersistence', 'storageDomain']

  private table?: KvTable<SessionId, DeletionPlanRecord>
  private readonly tails = new Map<SessionId, Promise<unknown>>()
  /** Members of an in-flight plan; `session/created` rolls back these ids. */
  private readonly activeMembers = new Set<SessionId>()

  constructor(ctx: Context) {
    super(ctx, 'sessionDeletion')
    // This listener is the synchronous lifecycle boundary: a session that
    // attaches while its id is in an active deletion plan rolls back instead
    // of racing the destructive writes.
    this.ctx.on('session/created', (session) => {
      if (!this.activeMembers.has(session.header.id)) return
      throw new SessionDeletionError(
        'session-running',
        `cannot create session "${session.header.id}" while it is being deleted`,
        [session.header.id],
      )
    })
  }

  /** Open the durable deletion-plan domain. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(deletionDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'session-deletion.domainClose')
    this.table = domain.table('plans')
  }

  private requireTable(): KvTable<SessionId, DeletionPlanRecord> {
    if (this.table === undefined) throw new Error('session deletion service is not started yet')
    return this.table
  }

  private serialize<T>(id: SessionId, operation: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(id) ?? Promise.resolve()
    const result = prior.then(operation, operation)
    const tail = result.then(() => undefined, () => undefined)
    this.tails.set(id, tail)
    void tail.then(() => {
      if (this.tails.get(id) === tail) this.tails.delete(id)
    })
    return result
  }

  /**
   * Permanently delete one session and, when `recursive` is true, its
   * descendant subagent sessions leaves-first.
   * @param input - target and recursion switch.
   * @returns every plan member, in plan order.
   */
  delete(
    input: { readonly sessionId: SessionId; readonly recursive: boolean },
  ): Promise<{ readonly deletedSessionIds: SessionId[] }> {
    return this.serialize(input.sessionId, () => this.deleteCore(input))
  }

  private async deleteCore(
    input: { readonly sessionId: SessionId; readonly recursive: boolean },
  ): Promise<{ readonly deletedSessionIds: SessionId[] }> {
    const { sessionId, recursive } = input
    const table = this.requireTable()
    const existingPlan = table.get(sessionId)

    const identities = new Map<SessionId, SessionIdentity>()
    for (const session of this.ctx.sessions.list()) {
      identities.set(session.header.id, {
        parentSession: session.header.parentSession,
      })
    }
    const persisted = await this.ctx.sessionPersistence.list()
    for (const meta of persisted) {
      identities.set(meta.id, { parentSession: meta.parentSession })
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
    const currentOrder = leavesFirst([...closure], children)

    if (!recursive && closure.size > 1) {
      throw new SessionDeletionError(
        'session-has-descendants',
        `session "${sessionId}" has descendant subagent sessions; pass recursive: true to delete them too`,
      )
    }
    if (existingPlan === undefined && !identities.has(sessionId)) {
      throw new SessionDeletionError('session-not-found', `session "${sessionId}" does not exist`)
    }

    // Merge the durable plan with any newly discovered members. Existing
    // progress is authoritative; new members start pending.
    const byId = new Map(existingPlan?.members.map(member => [member.sessionId, member]) ?? [])
    const ordered = [...(existingPlan?.members ?? [])]
    for (const id of currentOrder) {
      if (byId.has(id)) continue
      ordered.push({ sessionId: id, persistence: 'pending', workspace: 'pending' })
    }
    const plan: DeletionPlanRecord = {
      rootSessionId: sessionId,
      recursive,
      members: ordered,
      createdAt: existingPlan?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const running = plan.members
      .map(member => member.sessionId)
      .filter(id => this.ctx.sessions.get(id) !== undefined)
    if (running.length > 0) {
      throw new SessionDeletionError(
        'session-running',
        `cannot delete attached session(s): ${running.join(', ')}`,
        running,
      )
    }

    // The plan is durable before the first destructive write. From here on,
    // the active-member listener is the attach boundary.
    for (const member of plan.members) this.activeMembers.add(member.sessionId)
    try {
      await table.put(sessionId, plan)
      let latest = plan
      for (const member of latest.members) {
        if (member.persistence === 'pending') {
          const stillLive = this.ctx.sessions.get(member.sessionId) !== undefined
          if (stillLive) {
            throw new SessionDeletionError(
              'session-running',
              `session "${member.sessionId}" became attached during deletion`,
              [member.sessionId],
            )
          }
          try {
            await this.ctx.sessionPersistence.delete(member.sessionId)
            latest = await this.advance(latest, member.sessionId, {
              persistence: 'done',
            })
          } catch (error) {
            if (!isNotFound(error)) throw error
            latest = await this.advance(latest, member.sessionId, {
              persistence: 'missing',
            })
          }
        }
        if (member.workspace === 'pending') {
          const registry = this.ctx.get('workspaceRegistry')
          if (registry === undefined) {
            latest = await this.advance(latest, member.sessionId, {
              workspace: 'skipped',
            })
          } else {
            await registry.forgetSession(member.sessionId)
            latest = await this.advance(latest, member.sessionId, {
              workspace: 'done',
            })
          }
        }
      }
      await table.delete(sessionId)
      return { deletedSessionIds: latest.members.map(member => member.sessionId) }
    } finally {
      for (const member of plan.members) this.activeMembers.delete(member.sessionId)
    }
  }

  /** Persist one member-state transition before the next operation. */
  private async advance(
    plan: DeletionPlanRecord,
    sessionId: SessionId,
    patch: Partial<{ persistence: 'done' | 'missing'; workspace: 'done' | 'skipped' }>,
  ): Promise<DeletionPlanRecord> {
    const next: DeletionPlanRecord = {
      ...plan,
      updatedAt: new Date().toISOString(),
      members: plan.members.map(member => member.sessionId === sessionId
        ? { ...member, ...patch }
        : member),
    }
    await this.requireTable().put(plan.rootSessionId, next)
    return next
  }
}
