import { useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { type SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
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

const nodeOf = (session: SessionSummary, pending: string | undefined): PinnedRowNode => ({
  id: session.id,
  title: session.displayTitle,
  blank: session.blank,
  ...(pending === 'approval' || pending === 'plan-review' || pending === 'question' ? { pendingInteraction: pending } : {}),
  running: session.running,
  completed: session.completed === true,
  updatedAt: session.updatedAt,
})

function orderedByIds(
  nodes: readonly PinnedRowNode[],
  override: readonly SessionId[] | undefined,
): PinnedRowNode[] {
  if (override !== undefined && override.length > 0) {
    const remaining = new Map(nodes.map(node => [node.id, node]))
    const ordered = override.flatMap((id) => {
      const node = remaining.get(id)
      remaining.delete(id)
      return node === undefined ? [] : [node]
    })
    return [...ordered, ...remaining.values()]
  }
  return [...nodes].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function PinnedSection({
  wide, view, useSessions, useSessionPendingInteraction, useWorkspaces, usePanelInfo, useStore, actions,
  open, setPinned, reorderGroup, reorderFlat, renameSession, forkSession, archiveSession, workspaceT, t,
}: PropsRuntime<'sidebar.workspaces.pinned'>
  & PropsStore<ReturnType<typeof createPinnedSessionsStore>>
  & PinnedSessionsInjected
  & PropsLocale<'sessionPins'>) {
  const pendingInteractions = useSessionPendingInteraction(s => s)
  const sessions = useSessions(s => s)
  const panelActive = usePanelInfo(s => s.activePanelId !== null)
  const workspaces = useWorkspaces(s => s.items)
  const archivedSessionIds = useWorkspaces(s => s.archivedSessionIds)
  const ready = useStore(s => s.ready)
  const snapshot = useStore(s => s.snapshot)
  const [drag, setDrag] = useState<{ sourceId: SessionId; overId: SessionId | null; overHalf: 'before' | 'after' } | null>(null)

  const groups = useMemo<PinnedGroup[]>(() => {
    if (!ready || snapshot.pinnedSessionIds.length === 0) return []
    const byId = sessions.byId
    const archived = new Set(archivedSessionIds)
    const pinned = [...new Set(snapshot.pinnedSessionIds)].flatMap((id) => {
      const session = byId[id]
      return session === undefined || archived.has(id)
        ? []
        : [nodeOf(session, pendingInteractions.get(id)?.kind)]
    })
    if (pinned.length === 0) return []
    if (view === 'flat') {
      const nodes = orderedByIds(pinned, snapshot.flatOrder)
      return [{ key: '', label: t('pinned'), nodes }]
    }
    const owner = new Map(workspaces.flatMap(workspace => workspace.sessionIds.map(id => [id, workspace] as const)))
    const byGroup = new Map<string, PinnedGroup & { accountOrder: readonly SessionId[] | undefined }>()
    for (const node of pinned) {
      const workspace = owner.get(node.id)
      const key = workspace?.workspaceId ?? ''
      const group = byGroup.get(key)
      if (group === undefined) {
        byGroup.set(key, {
          key, label: workspace?.title ?? t('ungrouped'), nodes: [node], accountOrder: workspace?.sessionIds,
        })
      } else group.nodes.push(node)
    }
    return [...byGroup.values()].map(({ key, label, nodes, accountOrder }) => {
      const manualOrder = snapshot.groupOrder[key]
      const order = manualOrder !== undefined && manualOrder.length > 0 ? manualOrder : accountOrder
      return {
        key, label, nodes: orderedByIds(nodes, order),
      }
    })
  }, [pendingInteractions, ready, snapshot, sessions.byId, archivedSessionIds, view, workspaces, t])

  if (!wide || !ready || groups.length === 0) return null

  const rowAction = (owner: { sessionId: SessionId; flat: boolean; blank: boolean }): ReactNode => (
    <SessionPinAction
      {...owner}
      useSessions={useSessions}
      useSessionPendingInteraction={useSessionPendingInteraction}
      useWorkspaces={useWorkspaces}
      usePanelInfo={usePanelInfo}
      useStore={useStore}
      actions={actions}
      setPinned={setPinned}
      t={t}
    />
  )

  const makeDrag = (group: PinnedGroup, node: PinnedRowNode): NonNullable<ComponentProps<typeof PinnedSessionRow>['drag']> => {
    const common = {
      start: () => { setDrag({ sourceId: node.id, overId: null, overHalf: 'before' }) },
      marker: drag?.overId === node.id ? drag.overHalf : null,
      end: () => { setDrag(null) },
    }
    if (drag === null || !group.nodes.some(item => item.id === drag.sourceId)) return { ...common, active: false }
    const { sourceId } = drag
    return {
      ...common,
      active: true,
      hover: (half) => { setDrag({ sourceId, overId: node.id, overHalf: half }) },
      drop: (half) => {
        if (sourceId !== node.id) {
          const ids = group.nodes.map(item => item.id).filter(id => id !== sourceId)
          const to = ids.indexOf(node.id)
          ids.splice(half === 'before' ? to : to + 1, 0, sourceId)
          if (view === 'flat') void reorderFlat(ids, snapshot)
          else void reorderGroup(group.key, ids, snapshot)
        }
        setDrag(null)
      },
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
              currentId={panelActive ? undefined : sessions.current}
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
