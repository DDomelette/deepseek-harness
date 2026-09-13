// @vitest-environment jsdom
/**
 * What one material's detail draws and what its controls do: an editable body
 * while the material is a draft, a read-only one after it entered its
 * conversation, the thread the model produced, and the next question.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MaterialDetail } from '../src/client/MaterialDetail.tsx'
import type { NotesPanelProps } from '../src/client/NotesPanel.tsx'
import { harness, materialSummary, noteId } from './fixtures.client.ts'

afterEach(cleanup)

/** One material of a live conversation, as the list hands it to the detail. */
const draft = materialSummary({ noteId: noteId('n1'), text: 'body' })

/** Render the detail with the panel's own commands. */
function show(
  props: NotesPanelProps,
  material = draft,
  extra: {
    readonly thread?: Parameters<typeof MaterialDetail>[0]['thread']
    readonly loading?: boolean
    readonly failure?: Parameters<typeof MaterialDetail>[0]['threadFailure']
  } = {},
): void {
  render(
    <MaterialDetail
      material={material}
      thread={extra.thread ?? []}
      threadLoading={extra.loading ?? false}
      threadFailure={extra.failure}
      commands={props}
      t={props.t}
    />,
  )
}

describe('material detail', () => {
  it('edits a draft and saves it', async () => {
    const bench = harness()
    const props = bench.props()
    vi.spyOn(props, 'saveText')
    show(props)

    const editor = screen.getByLabelText('detail.body')
    fireEvent.change(editor, { target: { value: 'edited' } })
    fireEvent.click(screen.getByText('detail.save'))

    expect(props.saveText).toHaveBeenCalledExactlyOnceWith(draft.id, 'edited')
  })

  it('offers no save while the body is unchanged', () => {
    const bench = harness()
    show(bench.props())

    expect(screen.queryByText('detail.save')).toBeNull()
  })

  it('shows a submitted material read-only', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ noteId: noteId('n1'), text: 'body', submitted: true, status: 'analyzed' }))

    expect(screen.queryByLabelText('detail.body')).toBeNull()
    expect(document.querySelector('[data-notes-body]')?.textContent).toBe('body')
    expect(screen.getByText('status.analyzed')).toBeDefined()
  })

  it('names where the material came from', () => {
    const bench = harness()
    show(bench.props())

    expect(document.querySelector('[data-notes-source]')?.textContent).toContain('conversation «probe»')
    expect(screen.getByText('source.chat')).toBeDefined()
  })

  it('names a trajectory collection', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ source: { ...draft.source, view: 'trajectory' } }))

    expect(screen.getByText('source.trajectory')).toBeDefined()
  })

  it('names a screenshot collection', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ kind: 'image', text: null, hasImage: true }))

    expect(screen.getAllByText('source.image')).toHaveLength(1)
  })

  it('reports the reason a material failed', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ status: 'failed', error: 'inbox rejected' }))

    expect(screen.getByText('inbox rejected')).toBeDefined()
  })

  it('asks the Host to analyse, archive, and delete the material', () => {
    const bench = harness()
    const props = bench.props()
    const analyze = vi.spyOn(props, 'analyze')
    const archive = vi.spyOn(props, 'archive')
    const remove = vi.spyOn(props, 'remove')
    show(props)

    fireEvent.click(screen.getByText('detail.analyze'))
    fireEvent.click(screen.getByText('detail.archive'))
    fireEvent.click(screen.getByText('detail.remove'))

    expect(analyze).toHaveBeenCalledExactlyOnceWith(draft.id)
    expect(archive).toHaveBeenCalledExactlyOnceWith(draft.id)
    expect(remove).toHaveBeenCalledExactlyOnceWith(draft.id)
  })

  it('draws the thread the model produced', () => {
    const bench = harness()
    show(bench.props(), draft, {
      thread: [
        { role: 'user', text: 'body', seq: 0 },
        { role: 'assistant', text: 'answer', seq: 1 },
      ],
    })

    expect(document.querySelectorAll('[data-notes-row]')).toHaveLength(2)
    expect(screen.getByText('answer')).toBeDefined()
  })

  it('says so while the thread is being read and while it is empty', () => {
    const bench = harness()
    show(bench.props(), draft, { loading: true })
    expect(screen.getByText('detail.threadLoading')).toBeDefined()

    cleanup()
    show(bench.props())
    expect(screen.getByText('detail.threadEmpty')).toBeDefined()
  })

  it('reports why the thread could not be read', () => {
    const bench = harness()
    show(bench.props(), draft, { failure: { code: 'session-not-live', id: noteId('n1') } })

    expect(document.querySelector('[data-notes-thread-failure="session-not-live"]')).not.toBeNull()
    expect(screen.getByText('error.sessionNotLive')).toBeDefined()
    // A failed read says nothing about being empty.
    expect(screen.queryByText('detail.threadEmpty')).toBeNull()
  })

  it('asks a follow-up in the material\'s thread and clears the box', async () => {
    const bench = harness()
    const props = bench.props()
    const ask = vi.spyOn(props, 'ask')
    show(props)

    const box = screen.getByPlaceholderText('detail.ask')
    fireEvent.change(box, { target: { value: 'why?' } })
    fireEvent.submit(box.closest('form') as HTMLFormElement)

    expect(ask).toHaveBeenCalledExactlyOnceWith(draft.id, 'why?')
    await waitFor(() => { expect((box as HTMLInputElement).value).toBe('') })
  })

  it('asks nothing while the box is blank', () => {
    const bench = harness()
    const props = bench.props()
    const ask = vi.spyOn(props, 'ask')
    show(props)

    const box = screen.getByPlaceholderText('detail.ask')
    fireEvent.submit(box.closest('form') as HTMLFormElement)

    expect(ask).not.toHaveBeenCalled()
  })
})
