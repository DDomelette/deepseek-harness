import { useMemo, useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { PinnedSessionRow, type PinnedRowNode } from './PinnedSessionRow.tsx'
import { SessionPinAction } from './SessionPinAction.tsx'
import type { PinnedSessionsInjected } from './index.ts'
import type { createPinnedSessionsStore } from './stores.ts'
import css from './PinnedSection.module.css'

interface PinnedGroup {
  key: string
  label: string
  nodes: PinnedRowNode[]
}

const nodeOf = (session: SessionSummary): PinnedRowNode => ({
  id: session.id,
  title: session.displayTitle,
  blank: session.blank,
  ...(session.pendingInteraction === undefined ? {} : { pendingInteraction: session.pendingInteraction }),
  running: session.running,
  completed: session.completed === true,
  updatedAt: session.updatedAt,
})

function knownIds(
  ids: readonly SessionId[],
  sessions: Readonly<Record<SessionId, SessionSummary>>,
  archived: ReadonlySet<SessionId>,
): SessionId[] {
  return [...new Set(ids)].filter(id => sessions[id] !== undefined && !archived.has(id))
}

function orderedByIds(
  ids: readonly SessionId[],
  override: readonly SessionId[] | undefined,
  sessions: Readonly<Record<SessionId, SessionSummary>>,
): SessionId[] {
  if (override !== undefined && override.length > 0) {
    return [...new Set([...override, ...ids].filter(id => ids.includes(id)))]
  }
  return [...ids].sort((a, b) => (sessions[b]?.updatedAt ?? 0) - (sessions[a]?.updatedAt ?? 0))
}

export function PinnedSection({
  wide, view, useSessions, useWorkspaces, useStore, actions,
  open, setPinned, reorderGroup, reorderFlat, renameSession, forkSession, archiveSession, workspaceT, t,
}: PropsRuntime<'sidebar.workspaces.pinned'>
  & PropsStore<ReturnType<typeof createPinnedSessionsStore>>
  & PinnedSessionsInjected
  & PropsLocale<'sessionPins'>) {
  const sessions = useSessions(s => s)
  const workspaces = useWorkspaces(s => s.items)
  const archivedSessionIds = useWorkspaces(s => s.archivedSessionIds)
  const ready = useStore(s => s.ready)
  const snapshot = useStore(s => s.snapshot)
  const [drag, setDrag] = useState<{ sourceId: SessionId; overId: SessionId | null; overHalf: 'before' | 'after' } | null>(null)

  const groups = useMemo<PinnedGroup[]>(() => {
    if (!ready || snapshot.pinnedSessionIds.length === 0) return []
    const byId = sessions.byId
    const archived = new Set(archivedSessionIds)
    const pinned = knownIds(snapshot.pinnedSessionIds, byId, archived)
    if (pinned.length === 0) return []
    if (view === 'flat') {
      const nodes = orderedByIds(pinned, snapshot.flatOrder, byId)
        .flatMap((id) => {
          const session = byId[id]
          return session === undefined ? [] : [nodeOf(session)]
        })
      return [{ key: '', label: t('pinned'), nodes }]
    }
    const owner = new Map<SessionId, string>()
    for (const workspace of workspaces) {
      for (const id of workspace.sessionIds) owner.set(id, workspace.workspaceId)
    }
    const labels = new Map(workspaces.map(workspace => [workspace.workspaceId as string, workspace.title]))
    const byGroup = new Map<string, SessionId[]>()
    for (const id of pinned) {
      const key = owner.get(id) ?? ''
      const list = byGroup.get(key)
      if (list === undefined) byGroup.set(key, [id])
      else list.push(id)
    }
    return [...byGroup.entries()].map(([key, ids]) => {
      const override = snapshot.groupOrder[key]
      const accountOrder = key === ''
        ? undefined
        : workspaces.find(workspace => workspace.workspaceId === key)?.sessionIds
      let ordered: SessionId[]
      if (override !== undefined && override.length > 0) {
        ordered = orderedByIds(ids, override, byId)
      } else if (accountOrder !== undefined) {
        const rank = new Map(accountOrder.map((id, index) => [id, index]))
        ordered = [...ids].sort((a, b) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER))
      } else {
        ordered = orderedByIds(ids, undefined, byId)
      }
      return {
        key,
        label: key === '' ? t('ungrouped') : labels.get(key) ?? key,
        nodes: ordered.flatMap((id) => {
          const session = byId[id]
          return session === undefined ? [] : [nodeOf(session)]
        }),
      }
    })
  }, [ready, snapshot, sessions.byId, archivedSessionIds, view, workspaces, t])

  if (!wide || !ready || groups.length === 0) return null

  const rowAction = (owner: { sessionId: SessionId; flat: boolean; blank: boolean }): ReactNode => (
    <SessionPinAction
      {...owner}
      useSessions={useSessions}
      useWorkspaces={useWorkspaces}
      useStore={useStore}
      actions={actions}
      setPinned={setPinned}
      t={t}
    />
  )

  const makeDrag = (group: PinnedGroup, node: PinnedRowNode): {
    start: () => void
    active: boolean
    marker: 'before' | 'after' | null
    hover: (half: 'before' | 'after') => void
    drop: (half: 'before' | 'after') => void
    end: () => void
  } | undefined => {
    const commit = (over: PinnedRowNode, half: 'before' | 'after'): void => {
      if (drag === null || drag.sourceId === over.id) return
      const ids = group.nodes.map(item => item.id)
      const from = ids.indexOf(drag.sourceId)
      const to = ids.indexOf(over.id)
      if (from === -1 || to === -1) return
      ids.splice(from, 1)
      ids.splice(half === 'before' ? to : to + 1, 0, drag.sourceId)
      if (view === 'flat') void reorderFlat(ids, snapshot)
      else void reorderGroup(group.key, ids, snapshot)
    }
    return {
      start: () => { setDrag({ sourceId: node.id, overId: null, overHalf: 'before' }) },
      active: drag?.sourceId === node.id,
      marker: drag?.sourceId === node.id && drag.overId === node.id ? drag.overHalf : null,
      hover: (half) => { setDrag(current => current === null ? current : { ...current, overId: node.id, overHalf: half }) },
      drop: (half) => { commit(node, half); setDrag(null) },
      end: () => { setDrag(null) },
    }
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
              <span className={css.groupCount}>{group.nodes.length}</span>
            </div>
          )}
          {group.nodes.map(node => (
            <PinnedSessionRow
              key={node.id}
              node={node}
              currentId={sessions.current}
              now={Date.now()}
              onOpen={open}
              onRename={(id, title) => { void renameSession(id, title) }}
              onFork={forkSession}
              onArchive={(id) => { void archiveSession(id) }}
              pinAction={rowAction({ sessionId: node.id, flat: view === 'flat', blank: node.blank })}
              drag={makeDrag(group, node)}
              flat={view === 'flat'}
              t={workspaceT}
            />
          ))}
        </div>
      ))}
      <div className={css.divider}><span>{t('projects')}</span></div>
    </div>
  )
}
