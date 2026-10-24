import { describe, expect, it } from 'vitest'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import { type SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { type WorkspaceSnapshot as WorkspaceListState } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { countDescendants, deriveArchivedGroups } from '../src/client/derive.ts'

const sid = (value: string): SessionId => value as SessionId
const wid = (value: string): WorkspaceId => value as WorkspaceId

/** Deterministic instant the archive set stamps on the rows these cases derive. */
const ARCHIVED_AT = '2026-08-19T08:00:00.000Z'

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
  instants: Record<string, string> = Object.fromEntries(archived.map(id => [id, ARCHIVED_AT])),
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
      Object.entries(instants).map(([id, instant]) => [sid(id), instant]),
    ),
    state: 'idle',
    phase: 'ready',
    error: null,

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

  it('carries the session row fields the panel renders', () => {
    const groups = deriveArchivedGroups(
      sessions([['a1', 7]]),
      workspaces(['a1'], [['ws-a', ['a1']]]),
    )
    expect(groups[0]?.rows[0]).toMatchObject({
      id: sid('a1'), title: 'title-a1', updatedAt: 7, archivedAt: ARCHIVED_AT,
    })
  })

  it('leaves the archive instant absent for a Session archived before instants were recorded', () => {
    const groups = deriveArchivedGroups(
      sessions([['a1', 7]]),
      workspaces(['a1'], [['ws-a', ['a1']]], {}),
    )
    expect(groups[0]?.rows[0]?.archivedAt).toBeUndefined()
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
