/**
 * The material list: one row per material, the order the reader drags them
 * into, and the archived bucket under them.
 *
 * A row's title is the reader's own rename or the body's first line, with the
 * text below it as the preview. A row's tail handles — archive it, or open the
 * menu that renames it — float over the card's right edge while the row is
 * hovered or focused. The drop line marks where a dragged row would land, and
 * the order it produces is the complete list the Host's reorder takes — never
 * a pair of neighbours, so a drop cannot depend on what the list looked like
 * when the drag began.
 */
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, IconEllipsisOutline16, Input, Menu, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { MaterialId, NotesActionView, NotesMaterialSummary } from '../types.ts'
import { actionBadge } from './actions.ts'
import type { NotesInjected } from './face.ts'
import { materialTitle } from './title.ts'
import css from './MaterialList.module.css'

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
  const [menuFor, setMenuFor] = useState<MaterialId | null>(null)
  const [renaming, setRenaming] = useState<MaterialId | null>(null)
  const [draft, setDraft] = useState('')
  const composing = useRef(false)
  const rows = materials.map(row => ({ row, badge: actionBadge(row.action, actions) }))
  const renameRow = renaming === null ? undefined : materials.find(row => row.id === renaming)
  const trimmed = draft.trim()
  const closeRename = (): void => { setRenaming(null) }
  const confirmRename = (id: MaterialId): void => {
    if (trimmed === '') return
    commands.rename(id, trimmed)
    setRenaming(null)
  }
  const drop = (index: number): void => {
    if (dragging === null) return
    const next = orderAfter(materials, dragging, index)
    if (next !== null) commands.reorder(next)
    setDragging(null)
    setDropAt(null)
  }
  return (
    <>
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
                  <span className={css.rowTitle}>{materialTitle(row)}</span>
                  {badge !== null && (
                    <span className={css.rowAction} data-notes-action={badge.id}>
                      <Tag tone="neutral">{badge.label}</Tag>
                    </span>
                  )}
                </span>
                <span className={css.rowPreview}>{row.text ?? t('source.image')}</span>
              </span>
            </button>
            <span className={css.handles}>
              <Button
                size="sm"
                variant="outline"
                className={css.handle}
                aria-label={t('panel.archive')}
                data-notes-archive-material={row.id}
                onClick={() => { commands.archive(row.id) }}
              >
                {t('panel.archive')}
              </Button>
              <Menu
                open={menuFor === row.id}
                anchor={(
                  <Button
                    size="sm"
                    variant="outline"
                    className={css.handle}
                    aria-label={t('list.rowMenu')}
                    data-notes-row-menu={row.id}
                    onClick={() => { setMenuFor(open => (open === row.id ? null : row.id)) }}
                  >
                    <IconEllipsisOutline16 />
                  </Button>
                )}
                items={[{ id: 'rename', label: t('list.rename') }]}
                onSelect={() => {
                  setMenuFor(null)
                  setDraft(materialTitle(row))
                  setRenaming(row.id)
                }}
                onClose={() => { setMenuFor(null) }}
                align="end"
                portal
                dense
              />
            </span>
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
      {renaming !== null && renameRow !== undefined && (
        <Modal
          open
          onClose={closeRename}
          title={t('list.renameTitle')}
          closeLabel={t('list.cancel')}
          footer={(
            <>
              <Button variant="outline" onClick={closeRename}>{t('list.cancel')}</Button>
              {/* A blank title is no title; the body-derived one stays meanwhile. */}
              <Button variant="primary" disabled={trimmed === ''} data-notes-rename-save onClick={() => { confirmRename(renaming) }}>
                {t('list.save')}
              </Button>
            </>
          )}
        >
          <Input
            aria-label={t('list.renameField')}
            data-notes-rename-input
            value={draft}
            autoFocus
            onFocus={(event) => { event.target.select() }}
            onChange={(event) => { setDraft(event.target.value) }}
            onCompositionStart={() => { composing.current = true }}
            onCompositionEnd={() => { composing.current = false }}
            onKeyDown={(event) => {
              // An IME candidate window owns Enter while it composes.
              if (event.key === 'Enter' && !composing.current) {
                event.preventDefault()
                confirmRename(renaming)
              }
            }}
          />
        </Modal>
      )}
    </>
  )
}
