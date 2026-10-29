/** Workspace-specific adapter for the Gateway-owned snapshot stream lifecycle. */

import type { Context } from '@deepseek-ai/cordis'
import {
  RemoteSnapshotStream,
  RemoteStreamCarrierError,
  type ClientRemote,
} from '@deepseek-ai/dsh-api-gateway/client'
import type { WorkspaceFollowFrame, WorkspaceFollowIncrement } from '../types.ts'
import type { WorkspaceFollowSink } from './model.ts'
import { ClientWorkspaceModel } from './model.ts'
import { ClientSessionPinsModel } from './pins.ts'
import { WorkspaceController } from './service.ts'

export { ClientWorkspaceModel } from './model.ts'
export { ClientSessionPinsModel } from './pins.ts'
export type { SessionPinsRemote, SessionPinsSource } from './pins.ts'
// The ordered pin snapshot is the `session-pins` domain's own declaration, so
// a surface reads the very type the Host emits.
export type { SessionPinsSnapshot } from '@deepseek-ai/dsh-session-pins/types'
export type {
  WorkspaceFollowSink, WorkspaceListPhase, WorkspaceRemote, WorkspaceSnapshot,
} from './model.ts'
export { WorkspaceArchiveError, WorkspaceController, WorkspaceCreateError } from './service.ts'
export type { IWorkspaces, WorkspaceSource } from './service.ts'
export type {
  SessionActivity, SessionActivityItem, SessionActivityKind, SessionActivityKindMap, WorkspaceId,
  WorkspaceView,
} from '../types.ts'

type WorkspaceBaselineFrame = Extract<WorkspaceFollowFrame, { type: 'baseline' }>

/** Gateway-owned snapshot stream configured for Workspace state. */
export type WorkspaceStateStream = RemoteSnapshotStream<
  WorkspaceBaselineFrame,
  WorkspaceFollowIncrement
>

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** React-free Client Workspace state and commands. */
    workspaces: import('./service.ts').IWorkspaces
  }
}

/** Required Client Remote services. */
export const inject = ['remote', 'remote.workspace', 'remote.sessionPins']

/**
 * Install Client Workspace state, ordered pin state, commands, and
 * reconnecting follow control.
 * @param ctx - Client root Context.
 */
export function apply(ctx: Context): void {
  const model = new ClientWorkspaceModel(ctx.remote.workspace)
  const pins = new ClientSessionPinsModel(ctx.remote.sessionPins)
  new WorkspaceController(ctx, model, pins)
  const control = createWorkspaceStateStream(ctx.remote, {
    accept: model,
    carrierFailed: () => { model.handleCarrierFailure() },
    failed: (error) => { model.handleStreamFailure(error) },
  })
  control.start()
  // The pins snapshot is read on demand, not streamed: the first read and
  // every reconnection are when another surface's pins can have moved.
  void pins.reload()
  ctx.on('connection/reset', () => { void pins.reload() })
  ctx.effect(
    () => async () => { await control.dispose() },
    'workspace-controller.client.control',
  )
}

/** Domain sinks used by the Workspace state stream. */
export interface WorkspaceStateStreamOptions {
  /** Destinations for decoded Workspace state operations. */
  readonly accept: WorkspaceFollowSink
  /** Observe a retryable carrier loss before reconnection. */
  readonly carrierFailed?: (error: RemoteStreamCarrierError) => void
  /** Publish a terminal business or protocol failure. */
  readonly failed: (error: unknown) => void
}

/**
 * Create the reconnecting Workspace state stream.
 * @param remote - Client Remote face carrying the Workspace namespace and the stream factory.
 * @param options - Workspace state destinations.
 * @returns an unstarted stream owned by the Client Workspace runtime.
 */
export function createWorkspaceStateStream(
  remote: ClientRemote,
  options: WorkspaceStateStreamOptions,
): WorkspaceStateStream {
  const stream = remote.$stream<WorkspaceFollowFrame>({
    name: 'Workspace state stream',
    open: signal => remote.workspace.follow(signal),
    ended: accepted => accepted
      ? new RemoteStreamCarrierError('Workspace state stream ended without a terminal result')
      : new Error('Workspace state stream ended before its opening snapshot'),
    ...(options.carrierFailed === undefined ? {} : { carrierFailed: options.carrierFailed }),
  })
  return new RemoteSnapshotStream<WorkspaceBaselineFrame, WorkspaceFollowIncrement>(stream, {
    name: 'Workspace state stream',
    isSnapshot: (frame): frame is WorkspaceBaselineFrame => frame.type === 'baseline',
    replace: (frame) => { options.accept.replaceBaseline(frame.value) },
    update: (frame) => { acceptIncrement(options.accept, frame) },
    failed: options.failed,
  })
}

function acceptIncrement(accept: WorkspaceFollowSink, frame: WorkspaceFollowIncrement): void {
  switch (frame.type) {
    case 'upsert':
      accept.upsertView(frame.workspace)
      return
    case 'remove':
      accept.removeView(frame.workspaceId)
      return
    case 'order':
      accept.replaceOrder(frame.workspaceIds)
      return
    case 'archived':
      accept.replaceArchived(frame.archivedSessionIds, frame.archivedSessionAts)
      return
    case 'pinned':
      accept.replacePinned(frame.pinnedSessionIds)
      return
    /* v8 ignore next -- the generated Remote codec validates this closed union */
    default:
      return assertNever(frame)
  }
}

/* v8 ignore next 3 -- closed-union backstop after generated Remote validation */
function assertNever(value: never): never {
  throw new Error(`unreachable Workspace increment: ${JSON.stringify(value)}`)
}
