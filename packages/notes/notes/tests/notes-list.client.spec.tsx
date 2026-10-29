// @vitest-environment jsdom
/**
 * The material list: its rows and their titles, the rename dialog, the order a
 * drop produces, and the archived bucket under them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MaterialList, orderAfter } from '../src/client/MaterialList.tsx'
import { materialTitle } from '../src/client/title.ts'
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
  it('draws one row per material with its state, its title, and its preview', () => {
    const bench = harness()
    show(bench.props(), [row('m1', 'first'), row('m2', 'second')])

    expect(document.querySelectorAll('[data-notes-material]')).toHaveLength(2)
    // The title is the body's first line and the preview repeats the body.
    expect(screen.getAllByText('first')).toHaveLength(2)
    expect(document.querySelector('[data-notes-dot="draft"]')).not.toBeNull()
    // The row no longer names its source view.
    expect(screen.queryByText('source.chat')).toBeNull()
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

    fireEvent.click(document.querySelector('[data-notes-select="m1"]') as Element)
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

describe('material title', () => {
  it('derives the title from the body: first non-blank line, trimmed, capped', () => {
    expect(materialTitle({ title: null, text: 'first line\nsecond', source: { label: 'src' } }))
      .toBe('first line')
    expect(materialTitle({ title: null, text: '\n  \n  padded  ', source: { label: 'src' } })).toBe('padded')
    expect(materialTitle({ title: null, text: 'x'.repeat(45), source: { label: 'src' } }))
      .toBe(`${'x'.repeat(40)}…`)
    expect(materialTitle({ title: null, text: 'x'.repeat(40), source: { label: 'src' } })).toBe('x'.repeat(40))
  })

  it('prefers the stored title and falls back to the source label without text', () => {
    expect(materialTitle({ title: 'mine', text: 'body', source: { label: 'src' } })).toBe('mine')
    expect(materialTitle({ title: null, text: null, source: { label: 'src' } })).toBe('src')
  })

  it('renames a material from the row menu', async () => {
    const bench = harness()
    show(bench.props(), [row('m1', 'first')])

    fireEvent.click(document.querySelector('[data-notes-row-menu="m1"]') as Element)
    fireEvent.click(await screen.findByText('list.rename'))
    const input = screen.getByLabelText<HTMLInputElement>('list.renameField')
    // The dialog opens with the title the row shows.
    expect(input.value).toBe('first')
    fireEvent.change(input, { target: { value: '  新标题 ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // The command's write chain settles asynchronously.
    await vi.waitFor(() => {
      expect(bench.remote.materialRename).toHaveBeenCalledExactlyOnceWith({ id: materialId('m1'), title: '新标题' })
    })
    expect(screen.queryByLabelText('list.renameField')).toBeNull()
  })

  it('confirms a rename from the dialog button and refuses a blank title', async () => {
    const bench = harness()
    show(bench.props(), [row('m1', 'first')])

    fireEvent.click(document.querySelector('[data-notes-row-menu="m1"]') as Element)
    fireEvent.click(await screen.findByText('list.rename'))
    const input = screen.getByLabelText<HTMLInputElement>('list.renameField')
    fireEvent.change(input, { target: { value: '   ' } })
    expect(screen.getByText('list.save').closest('button')?.disabled).toBe(true)
    // A blank draft commits nothing from the keyboard either.
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(bench.remote.materialRename).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'renamed' } })
    fireEvent.click(screen.getByText('list.save'))

    await vi.waitFor(() => {
      expect(bench.remote.materialRename).toHaveBeenCalledExactlyOnceWith({ id: materialId('m1'), title: 'renamed' })
    })
  })

  it('lets an IME candidate window own Enter', async () => {
    const bench = harness()
    show(bench.props(), [row('m1', 'first')])

    fireEvent.click(document.querySelector('[data-notes-row-menu="m1"]') as Element)
    fireEvent.click(await screen.findByText('list.rename'))
    const input = screen.getByLabelText('list.renameField')
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '拼音' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(bench.remote.materialRename).not.toHaveBeenCalled()

    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    await vi.waitFor(() => {
      expect(bench.remote.materialRename).toHaveBeenCalledExactlyOnceWith({ id: materialId('m1'), title: '拼音' })
    })
  })

  it('closes the row menu without renaming', async () => {
    const bench = harness()
    show(bench.props(), [row('m1', 'first')])

    fireEvent.click(document.querySelector('[data-notes-row-menu="m1"]') as Element)
    expect(await screen.findByText('list.rename')).toBeDefined()

    // The anchor toggles its menu off again…
    fireEvent.click(document.querySelector('[data-notes-row-menu="m1"]') as Element)
    await vi.waitFor(() => { expect(screen.queryByText('list.rename')).toBeNull() })

    // …and a pointer outside closes an open menu.
    fireEvent.click(document.querySelector('[data-notes-row-menu="m1"]') as Element)
    expect(await screen.findByText('list.rename')).toBeDefined()
    fireEvent.pointerDown(document.body)
    await vi.waitFor(() => { expect(screen.queryByText('list.rename')).toBeNull() })
    expect(bench.remote.materialRename).not.toHaveBeenCalled()
  })

  it('cancels a rename without writing', async () => {
    const bench = harness()
    show(bench.props(), [row('m1', 'first')])

    fireEvent.click(document.querySelector('[data-notes-row-menu="m1"]') as Element)
    fireEvent.click(await screen.findByText('list.rename'))
    fireEvent.change(screen.getByLabelText('list.renameField'), { target: { value: 'typed' } })
    fireEvent.click(screen.getByText('list.cancel'))

    expect(screen.queryByLabelText('list.renameField')).toBeNull()
    expect(bench.remote.materialRename).not.toHaveBeenCalled()
  })
})
