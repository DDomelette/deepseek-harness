/**
 * The material list: one row per material, the order the reader drags them
 * into, and the archived bucket under them.
 *
 * A row carries its state, where it came from, its own text, and the
 * collection action that produced it; the handles that archive it and drag it
 * appear while the row is under the pointer. The drop line marks where a
 * dragged row would land, and the order it produces is the complete list the
 * Host's reorder takes — never a pair of neighbours, so a drop cannot depend on
 * what the list looked like when the drag began.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { MaterialId, NotesActionView, NotesMaterialSummary } from '../types.ts'
import { actionBadge } from './actions.ts'
import type { NotesInjected } from './face.ts'
import type { NotesKey } from './locales.ts'
import css from './MaterialList.module.css'

/** The dictionary line for each collection view. */
const VIEW_LINES: Readonly<Record<NotesMaterialSummary['source']['view'], NotesKey>> = {
  chat: 'source.chat',
  trajectory: 'source.trajectory',
}

/** The list's props: both buckets, the open material, and the panel's commands. */
export interface MaterialListProps {
  /** Listed materials, top-most first. */
  readonly materials: readonly NotesMaterialSummary[]
  /** Archived materials, most recently archived first. */
  readonly archived: readonly NotesMaterialSummary[]
  /** Material whose detail is open. */
  readonly selected: MaterialId | null
  /** Collection actions the settings section lists, for each row's badge. */
  readonly actions: readonly NotesActionView[]
  /** The panel's commands. */
  readonly commands: NotesInjected
  /** Namespace-bound translate. */
  readonly t: PropsLocale<'notes'>['t']
}

/**
 * The order one drop produces.
 * @param materials - the visible materials, top first.
 * @param id - the material being moved.
 * @param index - the row it was dropped on.
 * @returns the complete order, or null when the drop changes nothing.
 */
export function orderAfter(
  materials: readonly NotesMaterialSummary[],
  id: MaterialId,
  index: number,
): MaterialId[] | null {
  const ids = materials.map(row => row.id)
  const from = ids.indexOf(id)
  if (from < 0 || from === index) return null
  const next = [...ids]
  next.splice(from, 1)
  next.splice(index, 0, id)
  return next
}

/**
 * The list and its archived bucket.
 * @param props - both buckets, the open material, and the panel's commands.
 * @returns the list.
 */
export function MaterialList({
  materials, archived, selected, actions, commands, t,
}: MaterialListProps): ReactNode {
  const [dragging, setDragging] = useState<MaterialId | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const rows = materials.map(row => ({ row, badge: actionBadge(row.action, actions) }))
  const drop = (index: number): void => {
    if (dragging === null) return
    const next = orderAfter(materials, dragging, index)
    if (next !== null) commands.reorder(next)
    setDragging(null)
    setDropAt(null)
  }
  return (
    <ul className={css.list} data-notes-materials>
      {rows.map(({ row, badge }, index) => (
        <li
          key={row.id}
          className={css.row}
          draggable
          data-notes-material={row.id}
          data-notes-status={row.status}
          data-notes-open={row.id === selected ? '' : undefined}
          data-notes-drop={dragging !== null && dropAt === index ? '' : undefined}
          onDragStart={() => { setDragging(row.id) }}
          onDragEnd={() => { setDragging(null); setDropAt(null) }}
          onDragOver={(event) => {
            event.preventDefault()
            setDropAt(index)
          }}
          onDrop={(event) => {
            event.preventDefault()
            drop(index)
          }}
        >
          <button
            type="button"
            className={css.rowButton}
            aria-current={row.id === selected}
            data-notes-select={row.id}
            onClick={() => { commands.select(row.id) }}
          >
            <span className={css.dot} data-notes-dot={row.status} />
            <span className={css.rowText}>
              <span className={css.rowHead}>
                <span className={css.rowTitle}>{row.source.label}</span>
                {badge !== null && (
                  <span className={css.rowAction} data-notes-action={badge.id}>
                    <Tag tone="neutral">{badge.label}</Tag>
                  </span>
                )}
              </span>
              <span className={css.rowPreview}>{row.text ?? t('source.image')}</span>
            </span>
            <span className={css.rowSource}>
              {row.kind === 'image' ? t('source.image') : t(VIEW_LINES[row.source.view])}
            </span>
          </button>
          <button
            type="button"
            className={css.handle}
            aria-label={t('panel.archive')}
            data-notes-archive-material={row.id}
            onClick={() => { commands.archive(row.id) }}
          >
            {t('panel.archive')}
          </button>
        </li>
      ))}
      {materials.length === 0 && (
        <li className={css.emptyLine} data-notes-no-materials>{t('panel.noMaterials')}</li>
      )}
      {archived.length > 0 && (
        <li className={css.archivedSection} data-notes-archived>
          <button
            type="button"
            className={css.archivedToggle}
            aria-expanded={showArchived}
            data-notes-archived-toggle
            onClick={() => { setShowArchived(open => !open) }}
          >
            {t('panel.archived', { count: archived.length })}
          </button>
          {showArchived && archived.map(row => (
            <button
              key={row.id}
              type="button"
              className={css.archivedRow}
              data-notes-restore={row.id}
              onClick={() => { commands.restore(row.id) }}
            >
              <span className={css.rowPreview}>{row.text ?? t('source.image')}</span>
              <span className={css.rowSource}>{t('panel.restore')}</span>
            </button>
          ))}
        </li>
      )}
    </ul>
  )
}
