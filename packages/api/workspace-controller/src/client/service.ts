/** React-free Client Workspace service and command facade. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { WorkspaceView } from '../types.ts'
import type { ClientWorkspaceModel, WorkspaceSnapshot } from './model.ts'
import type { ClientSessionPinsModel, SessionPinsSource } from './pins.ts'

/** Structured create failure for callers that distinguish Host business errors. */
export class WorkspaceCreateError extends Error {
  override readonly name = 'WorkspaceCreateError'

  /** @param rpcError - Host business or folded carrier failure. */
  constructor(readonly rpcError: RemoteFailure) {
    super(`workspace create failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/**
 * Archive failed on the Host. `rpcError.code` distinguishes the active-session
 * refusal (`workspace/session-active`, whose details name what still runs)
 * from a missing session or a carrier fault.
 */
export class WorkspaceArchiveError extends Error {
  override readonly name = 'WorkspaceArchiveError'

  /** @param rpcError - Host business or folded carrier failure. */
  constructor(readonly rpcError: RemoteFailure) {
    super(`workspace session archive failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/** Bare observable source for the Workspace Controller snapshot. */
export interface WorkspaceSource {
  /** Read the identity-stable current snapshot. */
  getSnapshot(): WorkspaceSnapshot
  /**
   * Subscribe to snapshot changes.
   * @param listener - invalidation callback.
   * @returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void
}

/** Workspace Controller's Client service face. */
export interface IWorkspaces {
  /** Host-authoritative Workspace rows, order, archive set, and follow lifecycle. */
  readonly list: WorkspaceSource
  /**
   * Ordered pin state owned by `session-pins`: the pin set, its saved group
   * orders, and the flat display order. Read it for both membership and order;
   * the Workspace snapshot's pin projection need not be consulted.
   */
  readonly pins: SessionPinsSource
  /**
   * Register an existing path as a Workspace.
   * @param input - Host create payload.
   * @returns the created or idempotently resolved Workspace.
   */
  create(input: { path: string }): Promise<WorkspaceView>
  /**
   * Initialize or reuse the default Workspace.
   * @param signal - caller lifetime.
   * @returns the prepared Workspace, or undefined when first-use initialization is ineligible; rejects on preparation failure.
   */
  initializeDefault(signal?: AbortSignal): Promise<WorkspaceView | undefined>
  /**
   * Rename a Workspace.
   * @param workspaceId - target Workspace.
   * @param title - new display title.
   * @returns the renamed Workspace.
   */
  rename(workspaceId: WorkspaceId, title: string): Promise<WorkspaceView>
  /**
   * Delete a Workspace registration without deleting Sessions or files.
   * @param workspaceId - target Workspace.
   */
  delete(workspaceId: WorkspaceId): Promise<void>
  /**
   * Move a Workspace within the Host registry order.
   * @param workspaceId - Workspace to move.
   * @param beforeWorkspaceId - anchor Workspace; omitted appends.
   */
  insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void>
  /**
   * Archive a Session from Workspace grouping surfaces.
   * @param sessionId - Session to archive.
   * @param options - `stopActivity` asks the Host to stop the Session's running work instead of refusing.
   * @throws {WorkspaceArchiveError} when the Host refuses; without `stopActivity` a Session with
   *   running work fails as `workspace/session-active`, its details naming what runs.
   */
  archiveSession(sessionId: SessionId, options?: { readonly stopActivity?: boolean }): Promise<void>
  /**
   * Unarchive a Session from the archived Session list.
   * @param sessionId - Session to unarchive.
   */
  unarchiveSession(sessionId: SessionId): Promise<void>
  /**
   * Pin a Session ahead of unpinned Sessions on Workspace grouping surfaces.
   * @param sessionId - Session to pin.
   */
  pinSession(sessionId: SessionId): Promise<void>
  /**
   * Remove a Session's pin without changing its saved Session order.
   * @param sessionId - Session to unpin.
   */
  unpinSession(sessionId: SessionId): Promise<void>
  /**
   * Replace the complete pinned display order.
   * @param orderedIds - every pinned Session id, in display order; ids the
   *   owner does not hold pinned reject instead of reordering.
   * @throws when the Host refuses the order; the last committed order stays.
   */
  reorderPins(orderedIds: readonly SessionId[]): Promise<void>
  /**
   * Move a Session within one Workspace account.
   * @param workspaceId - owning Workspace.
   * @param sessionId - Session to move.
   * @param beforeSessionId - anchor Session; omitted appends.
   * @returns the changed Workspace.
   */
  insertSessionBefore(
    workspaceId: WorkspaceId,
    sessionId: SessionId,
    beforeSessionId?: SessionId,
  ): Promise<WorkspaceView>
}

/** Owns the bare Workspace snapshot and Workspace-only commands. */
export class WorkspaceController extends Service implements IWorkspaces {
  readonly list: WorkspaceSource
  readonly pins: SessionPinsSource

  /**
   * @param ctx - Client root Context.
   * @param model - Remote-backed Workspace state model.
   * @param pins - Remote-backed ordered pin model; a pin write through the
   *   Workspace namespace is re-read from it, because that namespace does not
   *   carry the order.
   */
  constructor(
    ctx: Context,
    private readonly model: ClientWorkspaceModel,
    private readonly pinsModel: ClientSessionPinsModel,
  ) {
    super(ctx, 'workspaces')
    this.list = model
    this.pins = pinsModel
  }

  async create(input: { path: string }): Promise<WorkspaceView> {
    const result = await this.model.create(input)
    if (!result.ok) throw new WorkspaceCreateError(result.error)
    return result.value.workspace
  }

  async initializeDefault(signal?: AbortSignal): Promise<WorkspaceView | undefined> {
    const result = await this.model.initializeDefault(signal)
    if (!result.ok) throw new WorkspaceCreateError(result.error)
    return result.value?.workspace
  }

  async rename(workspaceId: WorkspaceId, title: string): Promise<WorkspaceView> {
    const result = await this.model.rename(workspaceId, title)
    if (!result.ok) throw commandError('rename', result.error)
    return result.value.workspace
  }

  async delete(workspaceId: WorkspaceId): Promise<void> {
    const result = await this.model.delete(workspaceId)
    if (!result.ok) throw commandError('delete', result.error)
  }

  async insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void> {
    const result = await this.model.insertBefore(workspaceId, beforeWorkspaceId)
    if (!result.ok) throw commandError('reorder', result.error)
  }

  async archiveSession(sessionId: SessionId, options: { readonly stopActivity?: boolean } = {}): Promise<void> {
    const result = await this.model.archiveSession(sessionId, options)
    if (!result.ok) throw new WorkspaceArchiveError(result.error)
    // The Host drops an archived Session's pin through the pins owner, which
    // this namespace does not carry, so the ordered model is re-read.
    await this.pinsModel.reload()
  }

  async unarchiveSession(sessionId: SessionId): Promise<void> {
    const result = await this.model.unarchiveSession(sessionId)
    if (!result.ok) throw commandError('session unarchive', result.error)
  }

  async pinSession(sessionId: SessionId): Promise<void> {
    const result = await this.model.pinSession(sessionId)
    if (!result.ok) throw commandError('session pin', result.error)
    await this.pinsModel.reload()
  }

  async unpinSession(sessionId: SessionId): Promise<void> {
    const result = await this.model.unpinSession(sessionId)
    if (!result.ok) throw commandError('session unpin', result.error)
    await this.pinsModel.reload()
  }

  async reorderPins(orderedIds: readonly SessionId[]): Promise<void> {
    const result = await this.pinsModel.reorderFlat(orderedIds)
    if (!result.ok) throw commandError('session pin reorder', result.error)
  }

  async insertSessionBefore(
    workspaceId: WorkspaceId,
    sessionId: SessionId,
    beforeSessionId?: SessionId,
  ): Promise<WorkspaceView> {
    const result = await this.model.insertSessionBefore(workspaceId, sessionId, beforeSessionId)
    if (!result.ok) throw commandError('move', result.error)
    return result.value.workspace
  }
}

function commandError(operation: string, failure: RemoteFailure): Error {
  return new Error(`workspace ${operation} failed: ${failure.code}: ${failure.message}`)
}
