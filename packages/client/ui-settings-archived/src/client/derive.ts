/**
 * Pure projection from the sessions and workspaces baselines into archived
 * groups. Ordering is the product rule: workspace registry order, workspace
 * session order, then Ungrouped by updatedAt descending.
 */

import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'

export interface ArchivedRow {
  readonly id: SessionId
  readonly title: string
  readonly running: boolean
}

export interface ArchivedGroup {
  readonly key: string
  readonly title: string
  readonly rows: readonly ArchivedRow[]
}

export const UNGROUPED_KEY = 'ungrouped'

export function deriveArchivedGroups(
  sessions: SessionListState,
  workspaces: WorkspaceListState,
): ArchivedGroup[] {
  const archived = new Set(workspaces.archivedSessionIds)
  const rowFor = (id: SessionId): ArchivedRow | undefined => {
    const summary = sessions.byId[id]
    if (summary === undefined) return undefined
    return { id, title: summary.displayTitle, running: summary.running }
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
