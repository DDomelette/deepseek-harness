import { useMemo, useState } from 'react'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { PinnedSessionsInjected } from './index.ts'
import type { createPinnedSessionsStore, SessionPinsSnapshot } from './stores.ts'
import css from './PinnedSection.module.css'

interface PinnedRow {
  id: SessionId
  title: string
  time: string
  running: boolean
}

interface PinnedGroup {
  key: string
  label: string
  rows: PinnedRow[]
}

function rowOf(session: SessionSummary | undefined, id: SessionId): PinnedRow {
  return {
    id,
    title: session?.displayTitle ?? id,
    time: session === undefined ? '' : new Date(session.updatedAt).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit',
    }),
    running: session?.running === true,
  }
}

function orderedRows(
  ids: readonly SessionId[],
  override: readonly SessionId[] | undefined,
  sessions: Readonly<Record<SessionId, SessionSummary>>,
): PinnedRow[] {
  const set = new Set(ids)
  const order = override === undefined ? ids : [...override, ...ids.filter(id => !override.includes(id))]
  return order.filter(id => set.has(id)).map(id => rowOf(sessions[id], id))
}

export function PinnedSection({
  wide, view, useSessions, useWorkspaces, useStore, open, setPinned, reorderGroup, reorderFlat, t,
}: PropsRuntime<'sidebar.workspaces.pinned'>
  & PropsStore<ReturnType<typeof createPinnedSessionsStore>>
  & PinnedSessionsInjected
  & PropsLocale<'sessionPins'>) {
  const sessions = useSessions(s => s)
  const workspaces = useWorkspaces(s => s.items)
  const ready = useStore(s => s.ready)
  const snapshot = useStore(s => s.snapshot)
  const [dragId, setDragId] = useState<SessionId | null>(null)
  const [overId, setOverId] = useState<SessionId | null>(null)

  const groups = useMemo<PinnedGroup[]>(() => {
    if (!ready || snapshot.pinnedSessionIds.length === 0) return []
    const byId = sessions.byId
    if (view === 'flat') {
      const rows = orderedRows(snapshot.pinnedSessionIds, snapshot.flatOrder, byId)
      return rows.length === 0 ? [] : [{ key: '', label: t('pinned'), rows }]
    }
    const owner = new Map<SessionId, string>()
    for (const workspace of workspaces) {
      for (const id of workspace.sessionIds) owner.set(id, workspace.workspaceId as string)
    }
    const labels = new Map(workspaces.map(workspace => [workspace.workspaceId as string, workspace.title]))
    const groups = new Map<string, PinnedGroup>()
    for (const id of snapshot.pinnedSessionIds) {
      const key = owner.get(id) ?? ''
      let group = groups.get(key)
      if (group === undefined) {
        group = { key, label: key === '' ? t('ungrouped') : labels.get(key) ?? key, rows: [] }
        groups.set(key, group)
      }
      group.rows.push(rowOf(byId[id], id))
    }
    for (const group of groups.values()) {
      const accountOrder = group.key === ''
        ? undefined
        : workspaces.find(workspace => workspace.workspaceId === group.key)?.sessionIds
      group.rows = orderedRows(group.rows.map(row => row.id), snapshot.groupOrder[group.key], byId)
      if (accountOrder !== undefined) {
        const rank = new Map(accountOrder.map((id, index) => [id, index]))
        group.rows.sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER))
      }
    }
    return [...groups.values()]
  }, [ready, snapshot, sessions.byId, view, workspaces, t])

  if (!wide || !ready || snapshot.pinnedSessionIds.length === 0) return null

  const moveInGroup = (group: PinnedGroup, targetId: SessionId): void => {
    if (dragId === null || dragId === targetId) return
    const ids = group.rows.map(row => row.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from === -1 || to === -1) return
    ids.splice(from, 1)
    ids.splice(to, 0, dragId)
    void reorderGroup(group.key, ids, snapshot)
    setDragId(null)
    setOverId(null)
  }

  const moveFlat = (targetId: SessionId): void => {
    if (dragId === null || dragId === targetId) return
    const rows = groups[0]
    if (rows === undefined) return
    const ids = rows.rows.map(row => row.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from === -1 || to === -1) return
    ids.splice(from, 1)
    ids.splice(to, 0, dragId)
    void reorderFlat(ids, snapshot)
    setDragId(null)
    setOverId(null)
  }

  return (
    <div className={css.pinnedRoot}>
      <div className={css.pinnedHeader}>
        <span>{t('pinned')}</span>
        <span className={css.count}>{snapshot.pinnedSessionIds.length}</span>
      </div>
      {groups.map(group => (
        <div key={group.key} className={css.group}>
          {view === 'grouped' && (
            <div className={css.groupHeader}>
              <span className={css.groupLabel}>{group.label}</span>
              <span className={css.groupCount}>{group.rows.length}</span>
            </div>
          )}
          {group.rows.map(row => (
            <div
              key={row.id}
              className={clsx(css.sessionRow, overId === row.id && css.dropBefore)}
              draggable
              onDragStart={(event) => {
                setDragId(row.id)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', row.id)
              }}
              onDragOver={(event) => {
                event.preventDefault()
                setOverId(row.id)
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (view === 'flat') moveFlat(row.id)
                else moveInGroup(group, row.id)
              }}
              onClick={() => { open(row.id) }}
            >
              <span className={css.dot}>
                <i className={row.running ? css.dotRunning : ''} />
              </span>
              <span className={css.title}>{row.title}</span>
              <span className={css.time}>{row.time}</span>
              <button
                type="button"
                className={css.unpin}
                aria-label={t('unpin')}
                onClick={(event) => {
                  event.stopPropagation()
                  void setPinned(row.id, false, snapshot)
                }}
              >
                <svg className={css.pinIcon} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M16 3l5 5-3.5 3.5L19 16l-3 1-5-5-4.5 4.5L5 15l6-6-5-5 1-3 4.5 1.5L16 3z" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      ))}
      <div className={css.divider}><span>{t('projects')}</span></div>
    </div>
  )
}

export type { PinnedSessionsInjected, SessionPinsSnapshot }
