/**
 * Pure projection from the sessions and workspaces baselines into archived
 * groups. Ordering is the product rule: workspace registry order, workspace
 * session order, then Ungrouped by updatedAt descending.
 */

import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'

/** Archived session data displayed in one settings row. */
export interface ArchivedRow {
  readonly id: SessionId
  readonly title: string
  readonly running: boolean
  /** Last-activity epoch milliseconds from the session list summary. */
  readonly updatedAt: number
  /** Session working directory, absent when the host summary lacks one. */
  readonly cwd?: string
  /** Agent preset the session's agent was composed from, when the deployment labels it. */
  readonly agentPreset?: string
  /**
   * ISO-8601 archive instant; absent for sessions archived before the host
   * recorded archive times.
   */
  readonly archivedAt?: string
}

/** Archived sessions collected under one workspace or the ungrouped section. */
export interface ArchivedGroup {
  readonly key: string
  readonly title: string
  readonly rows: readonly ArchivedRow[]
}

/** Stable key for archived sessions that belong to no listed workspace. */
export const UNGROUPED_KEY = 'ungrouped'

/**
 * Project archived sessions into workspace-ordered settings groups.
 * @param sessions - Current session summaries keyed by session id.
 * @param workspaces - Current workspace order, membership, and archive metadata.
 * @returns Non-empty workspace groups followed by the optional ungrouped section.
 */
export function deriveArchivedGroups(
  sessions: SessionListState,
  workspaces: WorkspaceListState,
): ArchivedGroup[] {
  const archived = new Set(workspaces.archivedSessionIds)
  const rowFor = (id: SessionId): ArchivedRow | undefined => {
    const summary = sessions.byId[id]
    if (summary === undefined) return undefined
    const archivedAt = workspaces.archivedSessionAts[id]
    return {
      id,
      title: summary.displayTitle,
      running: summary.running,
      updatedAt: summary.updatedAt,
      ...(summary.cwd === undefined ? {} : { cwd: summary.cwd }),
      ...(summary.agentPreset === undefined ? {} : { agentPreset: summary.agentPreset }),
      ...(archivedAt === undefined ? {} : { archivedAt }),
    }
  }
  const groups: ArchivedGroup[] = []
  const accounted = new Set<SessionId>()
  for (const workspace of workspaces.items) {
    const rows = workspace.sessionIds
      .map(rowFor)
      .filter((row): row is ArchivedRow => row !== undefined && archived.has(row.id))
    if (rows.length === 0) continue
    for (const row of rows) accounted.add(row.id)
    groups.push({ key: workspace.workspaceId, title: workspace.title, rows })
  }
  const loose = workspaces.archivedSessionIds
    .filter(id => !accounted.has(id) && archived.has(id))
    .map(rowFor)
    .filter((row): row is ArchivedRow => row !== undefined)
    .sort((left, right) =>
      (sessions.byId[right.id]?.updatedAt ?? 0) - (sessions.byId[left.id]?.updatedAt ?? 0))
  if (loose.length > 0) groups.push({ key: UNGROUPED_KEY, title: '', rows: loose })
  return groups
}


/**
 * Count descendants below one session, stopping on lineage cycles.
 * @param sessions - Current session summaries and parent relationships.
 * @param rootId - Session whose descendants are counted.
 * @returns The number of distinct descendants reachable from the root.
 */
export function countDescendants(sessions: SessionListState, rootId: SessionId): number {
  const children = new Map<string, string[]>()
  for (const row of Object.values(sessions.byId)) {
    if (row.parentId === undefined) continue
    const list = children.get(row.parentId) ?? []
    list.push(row.id)
    children.set(row.parentId, list)
  }
  const visiting = new Set<string>()
  const seen = new Set<string>()
  const count = (id: string): number => {
    if (visiting.has(id) || seen.has(id)) return 0
    visiting.add(id)
    let total = 0
    for (const child of children.get(id) ?? []) {
      total += 1 + count(child)
    }
    visiting.delete(id)
    seen.add(id)
    return total
  }
  return count(rootId)
}
