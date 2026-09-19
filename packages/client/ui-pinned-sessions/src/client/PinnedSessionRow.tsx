import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  HoverCard, IconArchiveOutline20, IconBranchOutline16, IconEditOutline16,
  IconEllipsisOutline16, Menu, relativeTime, StateDot, StatusDots,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
type PendingInteractionStatus = 'approval' | 'plan-review' | 'question'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './PinnedSessionRow.module.css'

export interface PinnedRowNode {
  id: SessionId
  title: string
  blank: boolean
  pendingInteraction?: PendingInteractionStatus
  running: boolean
  completed: boolean
  updatedAt: number
}

function timeLabel(updatedAt: number, now: number, t: TranslateNS<'workspace'>): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
}

function hoverTimeLabel(updatedAt: number, now: number, t: TranslateNS<'workspace'>): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? t('time.now') : t('time.ago', { t: t(`time.${unit}`, { n }) })
}

interface SessionStatus {
  state: StateDotState
  label: string
}

function sessionStatuses(node: PinnedRowNode, t: TranslateNS<'workspace'>): readonly [SessionStatus, ...SessionStatus[]] {
  let pending: SessionStatus | undefined
  switch (node.pendingInteraction) {
    case 'approval': pending = { state: 'warning', label: t('status.waitingApproval') }; break
    case 'plan-review': pending = { state: 'warning', label: t('status.planReview') }; break
    case 'question': pending = { state: 'warning', label: t('status.waitingAnswer') }; break
    case undefined: break
  }
  if (pending !== undefined) return [pending]
  if (node.running) return [{ state: 'ongoing', label: t('status.running') }]
  if (node.completed) return [{ state: 'done', label: t('status.completed') }]
  return [{ state: 'done', label: t('status.idle') }]
}

export function PinnedSessionRow({
  node, currentId, now, onOpen, onRename, onFork, onArchive, pinAction, drag, flat, t,
}: {
  node: PinnedRowNode
  currentId: SessionId | undefined
  now: number
  onOpen: (id: SessionId) => void
  onRename: (id: SessionId, currentTitle: string) => void
  onFork: (id: SessionId) => void
  onArchive: (id: SessionId) => void
  pinAction: ReactNode
  drag?: {
    start: () => void
    marker: 'before' | 'after' | null
    end: () => void
  } & ({ active: false } | {
    active: true
    hover: (half: 'before' | 'after') => void
    drop: (half: 'before' | 'after') => void
  }) | undefined
  flat: boolean
  t: TranslateNS<'workspace'>
}) {
  const selected = node.id === currentId
  const statuses = sessionStatuses(node, t)
  const primaryStatus = statuses[0]
  const showStatus = primaryStatus.state !== 'done' || node.completed
  const [menuOpen, setMenuOpen] = useState(false)
  const menuItems = [
    { id: 'rename', label: t('rename'), icon: <IconEditOutline16 /> },
    { id: 'fork', label: t('menu.fork'), icon: <IconBranchOutline16 /> },
    { id: 'archive', label: t('menu.archiveSession'), icon: <IconArchiveOutline20 size={16} /> },
  ]
  const row = (
    <div
      className={clsx(
        css.sessionRow, selected && css.selected, menuOpen && css.menuOpen,
        // Each row plugin owns its selection styling and drag hit target.
        /* jscpd:ignore-start */
        flat && !showStatus && css.flatWithoutStatus,
        drag?.marker === 'before' && css.dropBefore, drag?.marker === 'after' && css.dropAfter,
      )}
      role="treeitem"
      aria-selected={selected}
      onClick={() => { onOpen(node.id) }}
      draggable={drag !== undefined /* jscpd:ignore-end */}
      onDragStart={drag === undefined ? undefined : (event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', node.id)
        drag.start()
      }}
      onDragEnd={drag?.end}
      onDragOver={drag === undefined ? undefined : (event) => {
        if (!drag.active) return
        event.preventDefault()
        const rect = event.currentTarget.getBoundingClientRect()
        drag.hover(event.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
      }}
      onDrop={drag === undefined ? undefined : (event) => {
        if (!drag.active) return
        event.preventDefault()
        const rect = event.currentTarget.getBoundingClientRect()
        drag.drop(event.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
      }}
    >
      {(!flat || showStatus) && (
        <span className={css.slot}>
          {showStatus && <StatusDots statuses={statuses} />}
        </span>
      )}
      <span className={css.title}>{node.title}</span>
      {!node.blank && <span className={css.time}>{timeLabel(node.updatedAt, now, t)}</span>}
      {!node.blank && (
        <span className={css.rowActions}>
          {pinAction}
          <Menu
            open={menuOpen}
            onClose={() => { setMenuOpen(false) }}
            items={menuItems}
            onSelect={(id) => {
              setMenuOpen(false)
              if (id === 'rename') onRename(node.id, node.title)
              if (id === 'fork') onFork(node.id)
              if (id === 'archive') onArchive(node.id)
            }}
            portal
            closeOnPointerLeave
            anchor={(
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('actions.session.aria', { name: node.title })}
                onClick={(event) => { event.stopPropagation(); setMenuOpen(value => !value) }}
              >
                <IconEllipsisOutline16 />
              </button>
            )}
          />
        </span>
      )}
    </div>
  )
  if (node.blank) return row
  return (
    <HoverCard
      anchor={row}
      content={(
        <div className={css.hoverContent}>
          <div className={css.hoverTitle}>{node.title}</div>
          <div className={css.hoverTime}>{hoverTimeLabel(node.updatedAt, now, t)}</div>
          {statuses.map(status => (
            <div className={css.hoverStatus} key={status.label}>
              <StateDot state={status.state} />
              <span>{status.label}</span>
            </div>
          ))}
        </div>
      )}
      disabled={menuOpen || drag?.active === true}
      copyText={node.title}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  )
}
