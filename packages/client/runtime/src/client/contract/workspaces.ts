/**
 * The outward workspaces-service face — what `ctx.workspaces` exposes to
 * feature packages and the renderer host, and therefore exactly what the
 * test runtime's workspaces double must implement. Wire-pump entry points
 * (handleHostEnvelope/handleConnected/refresh/startInitialSelection) stay on
 * the concrete class. Widening this interface is the explicit act of
 * widening what features may do to the workspaces domain.
 */
import type {
  DirectoryListing, RpcError, SessionId, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionFlags } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { ObservableSnapshot } from './store.ts'

/** Monotone workspace-list arrival lifecycle. */
export type WorkspaceListPhase = 'pending' | 'ready'

/** Workspace list plus the two-baseline readiness and default-target projection. */
export interface WorkspaceListState {
  items: readonly WorkspaceView[]
  /**
   * Registry-global archive set in Host order: grouping surfaces hide these
   * sessions everywhere (workspace groups and the ungrouped bucket) while
   * their session logs and workspace accounting slots remain. A plain array
   * (store-engine vocabulary; immer drafts reject Sets) — membership lookups
   * build their own transient Set.
   */
  archivedSessionIds: readonly SessionId[]
  /**
   * ISO-8601 archive instants keyed by session id, key-equal to
   * `archivedSessionIds`; sessions archived before the Host recorded times
   * carry no entry.
   */
  archivedSessionAts: Readonly<Record<SessionId, string>>
  /** Generic session flags merged from host providers; absent for pre-baseline or legacy test fixtures. */
  sessionFlags?: Readonly<Record<SessionId, SessionFlags>>
  state: 'idle' | 'loading' | 'error'
  phase: WorkspaceListPhase
  error: RpcError | null
  /** True only after both workspace.list and session.list have succeeded. */
  baselinesReady: boolean
  /** Most recently active Workspace, derived without changing `items` order. */
  recentWorkspaceId: WorkspaceId | undefined
}

/** The workspaces-service face injected as `ctx.workspaces`. */
export interface IWorkspaces {
  /** The useWorkspaces standard feed (read face — writes stay inside the domain). */
  readonly list: ObservableSnapshot<WorkspaceListState>
  /**
   * Connect a Workspace to its reusable or freshly created blank session.
   * @param workspaceId - target workspace.
   * @returns the connected session id.
   */
  connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId>
  /**
   * The New Session flow: connect the explicit, current-Session, or recent
   * Workspace and open the resulting session; failures surface on the session
   * list state.
   * @param workspaceId - explicit target; omitted inherits the current
   * Session's Workspace before falling back to the recency projection.
   */
  startSession(workspaceId?: WorkspaceId): void
  /**
   * Register an existing path as a Workspace.
   * @param input - the Host create payload.
   * @returns the created or idempotently resolved Workspace.
   */
  create(input: { path: string }): Promise<WorkspaceView>
  /**
   * Open the Host's native directory picker.
   * @returns the selected path, or null when the user cancelled.
   */
  pickDirectory(): Promise<string | null>
  /**
   * List one directory level through the Host's `browse` capability.
   * @param path - absolute directory to list; absent lists the Host home directory.
   * @param signal - aborts the wire request (and the Host's scan) when the caller supersedes it.
   * @returns the level's listing with breadcrumb ancestry.
   */
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  /**
   * Create one child directory through the Host's `browse` capability.
   * @param path - absolute existing parent directory.
   * @param name - single non-blank path segment.
   * @returns the created directory's absolute path.
   */
  createDirectory(path: string, name: string): Promise<string>
  /**
   * Open a filesystem path with the Host operating system's default application.
   * @param path - absolute or host-resolvable path.
   */
  openPath(path: string): Promise<void>
  /**
   * Rename a Workspace.
   * @param workspaceId - target workspace.
   * @param title - the new display title.
   * @returns the updated Workspace view.
   */
  rename(workspaceId: WorkspaceId, title: string): Promise<WorkspaceView>
  /**
   * Delete a Workspace (its sessions fall back to the unaccounted group).
   * @param workspaceId - target workspace.
   */
  delete(workspaceId: WorkspaceId): Promise<void>
  /**
   * Move a Workspace within the registry display order.
   * @param workspaceId - Workspace to move.
   * @param beforeWorkspaceId - Anchor workspace; omitted appends.
   */
  insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void>
  /**
   * Move an accounted session within/into a Workspace's ordered list.
   * @param workspaceId - target workspace.
   * @param sessionId - accounted session to move.
   * @param beforeSessionId - accounted anchor to insert before; omitted appends.
   * @returns the updated Workspace view.
   */
  insertSessionBefore(workspaceId: WorkspaceId, sessionId: SessionId, beforeSessionId?: SessionId): Promise<WorkspaceView>
  /**
   * Archive a session into the registry-global set (hidden from grouping
   * surfaces; session log and accounting slot remain). Archiving the current
   * session clears the selection into the New Session view state.
   * @param sessionId - session to archive.
   */
  archiveSession(sessionId: SessionId): Promise<void>
  /**
   * Remove one session from the registry-global archive set.
   * @param sessionId - archived session to restore.
   */
  unarchiveSession(sessionId: SessionId): Promise<void>
  /**
   * Re-pull the workspace baseline, reusing an in-flight pull.
   */
  refresh(): Promise<void>
  /**
   * Replace the local sessionFlags mirror from a same-client producer.
   * Host baselines remain authoritative on the next `workspace.list`.
   * @param sessionFlags - complete replacement map.
   */
  installSessionFlags(sessionFlags: Readonly<Record<SessionId, SessionFlags>>): void
}
