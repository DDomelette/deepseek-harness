import { describe, expect, it } from 'vitest'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { countDescendants, deriveArchivedGroups } from '@deepseek-ai/dsh-client-ui-settings-archived/client'

const sid = (value: string): SessionId => value as SessionId
const wid = (value: string): WorkspaceId => value as WorkspaceId

function sessions(rows: Array<[string, number]>): SessionListState {
  return {
    ids: rows.map(([id]) => sid(id)),
    byId: Object.fromEntries(rows.map(([id, updatedAt]) => [
      sid(id),
      { id: sid(id), displayTitle: `title-${id}`, updatedAt, running: false, blank: false },
    ])),
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  } as unknown as SessionListState
}

function workspaces(
  archived: string[],
  rows: Array<[string, string[]]>,
  archivedAts: Record<string, string> = {},
): WorkspaceListState {
  return {
    items: rows.map(([id, sessionIds]) => ({
      workspaceId: wid(id),
      path: `/work/${id}`,
      title: id,
      sessionIds: sessionIds.map(sid),
      createdAt: '0',
      updatedAt: '0',
    })),
    archivedSessionIds: archived.map(sid),
    archivedSessionAts: Object.fromEntries(
      Object.entries(archivedAts).map(([id, at]) => [sid(id), at]),
    ),
    state: 'idle',
    phase: 'ready',
    error: null,
    baselinesReady: true,
    recentWorkspaceId: undefined,
  } as unknown as WorkspaceListState
}

describe('deriveArchivedGroups', () => {
  it('keeps workspace order, workspace session order, and puts ungrouped last by updatedAt', () => {
    const groups = deriveArchivedGroups(
      sessions([['loose-1', 3], ['loose-2', 9], ['a1', 1], ['a2', 2], ['b1', 5]]),
      workspaces(['loose-1', 'loose-2', 'a1', 'a2', 'b1'], [
        ['ws-a', ['a2', 'a1']],
        ['ws-b', ['b1']],
      ]),
    )
    expect(groups.map(group => [group.key, group.rows.map(row => row.id)])).toEqual([
      ['ws-a', [sid('a2'), sid('a1')]],
      ['ws-b', [sid('b1')]],
      ['ungrouped', [sid('loose-2'), sid('loose-1')]],
    ])
  })

  it('drops empty groups and archived ids missing from session.list', () => {
    const groups = deriveArchivedGroups(
      sessions([['a1', 1]]),
      workspaces(['a1', 'ghost'], [['ws-a', ['a1']], ['ws-empty', []]]),
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]?.rows.map(row => row.id)).toEqual([sid('a1')])
  })

  it('carries the archive instant when the host recorded one and omits it otherwise', () => {
    const groups = deriveArchivedGroups(
      sessions([['a1', 1], ['a2', 2]]),
      workspaces(['a1', 'a2'], [['ws-a', ['a1', 'a2']]], { a1: '2026-08-21T08:00:00.000Z' }),
    )
    expect(groups[0]?.rows[0]?.archivedAt).toBe('2026-08-21T08:00:00.000Z')
    expect(groups[0]?.rows[1]).not.toHaveProperty('archivedAt')
  })
})


describe('countDescendants', () => {
  it('stops on a parentId cycle instead of recursing forever', () => {
    const state = sessions([['a', 1], ['b', 2]])
    state.byId[sid('a')] = { ...state.byId[sid('a')]!, parentId: sid('b') }
    state.byId[sid('b')] = { ...state.byId[sid('b')]!, parentId: sid('a') }
    expect(countDescendants(state, sid('a'))).toBe(2)
  })
})
