// @vitest-environment jsdom
/**
 * The material list: its rows, the order a drop produces, and the archived
 * bucket under them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MaterialList, orderAfter } from '../src/client/MaterialList.tsx'
import type { NotesPanelProps } from '../src/client/NotesPanel.tsx'
import type { NotesActionView } from '../src/types.ts'
import { harness, materialId, materialSummary, noteId } from './fixtures.client.ts'

afterEach(cleanup)

/** The one collection action the deployments below configure. */
const translate: NotesActionView = {
  id: 'translate',
  label: '翻译',
  prompt: '不改变语句结构，翻译下列内容：',
  autoSend: true,
}

/** One listed material. */
const row = (id: string, text = id): ReturnType<typeof materialSummary> =>
  materialSummary({ id: materialId(id), noteId: noteId('n1'), text })

/** Render the list with the panel's own commands. */
function show(
  props: NotesPanelProps,
  materials: readonly ReturnType<typeof materialSummary>[] = [row('m1')],
  archived: readonly ReturnType<typeof materialSummary>[] = [],
  selected: string | null = null,
  actions: NotesActionView[] = [],
): void {
  render(
    <MaterialList
      materials={materials}
      archived={archived}
      selected={selected === null ? null : materialId(selected)}
      actions={actions}
      commands={props}
      t={props.t}
    />,
  )
}

describe('material list', () => {
  it('draws one row per material with its state and source', () => {
    const bench = harness()
    show(bench.props(), [row('m1', 'first'), row('m2', 'second')])

    expect(document.querySelectorAll('[data-notes-material]')).toHaveLength(2)
    expect(screen.getByText('first')).toBeDefined()
    expect(document.querySelector('[data-notes-dot="draft"]')).not.toBeNull()
    expect(screen.getAllByText('source.chat')).toHaveLength(2)
  })

  it('says the conversation has no materials yet', () => {
    const bench = harness()
    show(bench.props(), [])

    expect(screen.getByText('panel.noMaterials')).toBeDefined()
  })

  it('opens a material and archives it from its row', () => {
    const bench = harness()
    const props = bench.props()
    const select = vi.spyOn(props, 'select')
    const archive = vi.spyOn(props, 'archive')
    show(props)

    fireEvent.click(screen.getByText('m1'))
    fireEvent.click(screen.getByLabelText('panel.archive'))

    expect(select).toHaveBeenCalledExactlyOnceWith(materialId('m1'))
    expect(archive).toHaveBeenCalledExactlyOnceWith(materialId('m1'))
  })

  it('marks the open material as current', () => {
    const bench = harness()
    show(bench.props(), [row('m1'), row('m2')], [], 'm2')

    expect(document.querySelector('[data-notes-material="m2"]')?.getAttribute('data-notes-open')).toBe('')
    expect(document.querySelector('[data-notes-material="m1"]')?.getAttribute('data-notes-open')).toBeNull()
  })

  it('reorders from a complete drop, not from the pair of rows', () => {
    const bench = harness()
    const props = bench.props()
    const reorder = vi.spyOn(props, 'reorder')
    show(props, [row('m1'), row('m2'), row('m3')])

    const rows = document.querySelectorAll('[data-notes-material]')
    fireEvent.dragStart(rows[2] as Element)
    fireEvent.dragOver(rows[0] as Element)
    expect(document.querySelector('[data-notes-drop]')).not.toBeNull()
    fireEvent.drop(rows[0] as Element)

    expect(reorder).toHaveBeenCalledExactlyOnceWith([materialId('m3'), materialId('m1'), materialId('m2')])
  })

  it('asks for no reorder when a drop leaves the order alone', () => {
    const bench = harness()
    const props = bench.props()
    const reorder = vi.spyOn(props, 'reorder')
    show(props, [row('m1'), row('m2')])

    const rows = document.querySelectorAll('[data-notes-material]')
    fireEvent.dragStart(rows[1] as Element)
    fireEvent.drop(rows[1] as Element)

    expect(reorder).not.toHaveBeenCalled()
  })

  it('asks for no reorder when nothing was dragged', () => {
    const bench = harness()
    const props = bench.props()
    const reorder = vi.spyOn(props, 'reorder')
    show(props, [row('m1'), row('m2')])

    fireEvent.drop(document.querySelectorAll('[data-notes-material]')[0] as Element)

    expect(reorder).not.toHaveBeenCalled()
  })

  it('ends a drag without reordering when it is dropped outside', () => {
    const bench = harness()
    const props = bench.props()
    const reorder = vi.spyOn(props, 'reorder')
    show(props, [row('m1'), row('m2')])

    const rows = document.querySelectorAll('[data-notes-material]')
    fireEvent.dragStart(rows[1] as Element)
    fireEvent.dragOver(rows[0] as Element)
    fireEvent.dragEnd(rows[1] as Element)
    fireEvent.drop(rows[0] as Element)

    expect(reorder).not.toHaveBeenCalled()
  })

  it('folds the archived bucket away and takes a material back out of it', () => {
    const bench = harness()
    const props = bench.props()
    const restore = vi.spyOn(props, 'restore')
    show(props, [row('m1')], [row('m9', 'archived body')])

    expect(screen.getByText('panel.archived(count=1)')).toBeDefined()
    expect(screen.queryByText('archived body')).toBeNull()

    fireEvent.click(screen.getByText('panel.archived(count=1)'))
    expect(screen.getByText('archived body')).toBeDefined()

    fireEvent.click(screen.getByText('panel.restore'))

    expect(restore).toHaveBeenCalledExactlyOnceWith(materialId('m9'))
  })

  it('names an archived screenshot that has no text', () => {
    const bench = harness()
    const props = bench.props()
    show(props, [row('m1')], [materialSummary({
      id: materialId('m9'),
      kind: 'image',
      text: null,
      hasImage: true,
      archivedAt: 1,
    })])

    fireEvent.click(screen.getByText('panel.archived(count=1)'))

    expect(screen.getByText('source.image')).toBeDefined()
  })

  it('shows no archived bucket when nothing is archived', () => {
    const bench = harness()
    show(bench.props())

    expect(document.querySelector('[data-notes-archived]')).toBeNull()
  })

  it('names the collection action a row was collected through', () => {
    const bench = harness()
    show(bench.props(), [materialSummary({
      id: materialId('m1'),
      noteId: noteId('n1'),
      text: 'body',
      action: 'translate',
    })], [], null, [translate])

    expect(document.querySelector('[data-notes-action="translate"]')?.textContent).toBe('翻译')
  })

  it('falls back to the stored id for an action the configuration dropped', () => {
    const bench = harness()
    show(bench.props(), [materialSummary({ id: materialId('m1'), action: 'gone' })], [], null, [translate])

    expect(document.querySelector('[data-notes-action="gone"]')?.textContent).toBe('gone')
  })

  it('carries no badge on a material that names no action', () => {
    const bench = harness()
    show(bench.props(), [row('m1')], [], null, [translate])

    expect(document.querySelector('[data-notes-action]')).toBeNull()
  })
})

describe('drop order', () => {
  const rows = [row('m1'), row('m2'), row('m3')]

  it('moves a material down', () => {
    expect(orderAfter(rows, materialId('m1'), 2))
      .toEqual([materialId('m2'), materialId('m3'), materialId('m1')])
  })

  it('moves a material up', () => {
    expect(orderAfter(rows, materialId('m3'), 0))
      .toEqual([materialId('m3'), materialId('m1'), materialId('m2')])
  })

  it('asks for nothing when the drop keeps the position', () => {
    expect(orderAfter(rows, materialId('m2'), 1)).toBeNull()
  })

  it('asks for nothing for a material that is not listed', () => {
    expect(orderAfter(rows, materialId('absent'), 0)).toBeNull()
  })
})
