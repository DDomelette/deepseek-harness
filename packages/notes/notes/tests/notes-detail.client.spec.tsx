// @vitest-environment jsdom
/**
 * What one material's detail draws and what its controls do: an editable body
 * while the material is a draft, a read-only one after it entered its
 * conversation, the action template it will submit, the thread the model
 * produced, and the next question.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MaterialDetail } from '../src/client/MaterialDetail.tsx'
import type { NotesPanelProps } from '../src/client/NotesPanel.tsx'
import type { NotesActionView } from '../src/types.ts'
import { harness, materialSummary, noteId, sessionSeq, source } from './fixtures.client.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** One material of a live conversation, as the list hands it to the detail. */
const draft = materialSummary({ noteId: noteId('n1'), text: 'body' })

/** One material that already entered its conversation, so it has a thread. */
const submitted = materialSummary({ noteId: noteId('n1'), text: 'body', submitted: true, status: 'analyzed' })

/** The one collection action the deployments below configure. */
const translate: NotesActionView = {
  id: 'translate',
  label: '翻译',
  prompt: '不改变语句结构，翻译下列内容：',
  autoSend: true,
}

/** Install the async browser clipboard and restore its prior host shape. */
function installClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
}

/** Render the detail with the panel's own commands. */
function show(
  props: NotesPanelProps,
  material = draft,
  extra: {
    readonly thread?: Parameters<typeof MaterialDetail>[0]['thread']
    readonly loading?: boolean
    readonly failure?: Parameters<typeof MaterialDetail>[0]['threadFailure']
    readonly actions?: readonly NotesActionView[]
  } = {},
): void {
  render(
    <MaterialDetail
      material={material}
      thread={extra.thread ?? []}
      threadLoading={extra.loading ?? false}
      threadFailure={extra.failure}
      actions={extra.actions ?? []}
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
    show(bench.props(), submitted)

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

  it('names a screenshot collection where its text would be', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ noteId: noteId('n1'), kind: 'image', text: null, hasImage: true }))

    // Its source strip and its body both name it, and it offers no editor.
    expect(screen.getAllByText('source.image')).toHaveLength(2)
    expect(screen.queryByLabelText('detail.body')).toBeNull()
    expect(document.querySelector('[data-notes-body]')?.textContent).toBe('source.image')
  })

  it('offers the source row a locate entry for a position the material recorded', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ noteId: noteId('n1'), text: 'body', source: source({ seq: sessionSeq(42) }) }))

    expect(document.querySelector('[data-notes-locate]')).not.toBeNull()
  })

  it('offers the source row a locate entry for a recorded tool call too', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ noteId: noteId('n1'), text: 'body', source: source({ callId: 'call-7' }) }))

    expect(document.querySelector('[data-notes-locate]')).not.toBeNull()
  })

  it('offers no locate entry for a material that recorded no position', () => {
    const bench = harness()
    show(bench.props())

    expect(document.querySelector('[data-notes-locate]')).toBeNull()
  })

  it('explains that a recorded source cannot be opened yet', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ noteId: noteId('n1'), text: 'body', source: source({ seq: sessionSeq(42) }) }))

    expect(document.querySelector('[data-notes-locate-hint]')).toBeNull()

    fireEvent.click(screen.getByText('detail.locate'))

    expect(document.querySelector('[data-notes-locate-hint]')?.textContent).toBe('detail.locateHint')
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

  it('offers no analysis for a material that already entered its conversation', () => {
    const bench = harness()
    show(bench.props(), submitted)

    // The Host submits a material once, so the control would report success
    // while sending nothing.
    expect(document.querySelector('[data-notes-analyze]')).toBeNull()
  })

  it('draws the thread the model produced', () => {
    const bench = harness()
    show(bench.props(), draft, {
      thread: [
        { role: 'user', text: 'body', hasImage: false, seq: 0 },
        { role: 'assistant', text: 'answer', hasImage: false, seq: 1 },
      ],
    })

    expect(document.querySelectorAll('[data-notes-row]')).toHaveLength(2)
    expect(screen.getByText('answer')).toBeDefined()
  })

  it('names the screenshot a submitted row carried', () => {
    const bench = harness()
    show(bench.props(), submitted, {
      thread: [
        { role: 'user', text: '', hasImage: true, seq: 0 },
        { role: 'assistant', text: 'answer', hasImage: false, seq: 1 },
      ],
    })

    expect(document.querySelector('[data-notes-row-image]')?.textContent).toBe('source.image')
    expect(document.querySelectorAll('[data-notes-row]')).toHaveLength(2)
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
    show(props, submitted)

    const box = screen.getByPlaceholderText('detail.ask')
    fireEvent.change(box, { target: { value: 'why?' } })
    fireEvent.submit(box.closest('form') as HTMLFormElement)

    expect(ask).toHaveBeenCalledExactlyOnceWith(submitted.id, 'why?')
    await waitFor(() => { expect((box as HTMLInputElement).value).toBe('') })
  })

  it('asks nothing while the box is blank', () => {
    const bench = harness()
    const props = bench.props()
    const ask = vi.spyOn(props, 'ask')
    show(props, submitted)

    const box = screen.getByPlaceholderText('detail.ask')
    fireEvent.submit(box.closest('form') as HTMLFormElement)

    expect(ask).not.toHaveBeenCalled()
  })

  it('offers no follow-up before the material entered its conversation', () => {
    const bench = harness()
    show(bench.props())

    // The Host refuses the question in the same state, so the box is not drawn.
    expect(screen.queryByPlaceholderText('detail.ask')).toBeNull()
  })

  it('echoes the prompt template of the action the material names', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ noteId: noteId('n1'), text: 'body', action: 'translate' }), {
      actions: [translate],
    })

    expect(document.querySelector('[data-notes-action-template="translate"]')?.textContent)
      .toContain('不改变语句结构，翻译下列内容：')
  })

  it('echoes nothing for an action the configuration dropped', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ noteId: noteId('n1'), text: 'body', action: 'gone' }), {
      actions: [translate],
    })

    expect(document.querySelector('[data-notes-action-template]')).toBeNull()
  })

  it('copies the body it shows and reports the write', async () => {
    const bench = harness()
    const writeText = vi.fn(async () => {})
    installClipboard(writeText)
    show(bench.props())

    fireEvent.click(screen.getByText('detail.copy'))

    await waitFor(() => { expect(screen.getByText('detail.copied')).toBeDefined() })
    expect(writeText).toHaveBeenCalledExactlyOnceWith('body')
  })

  it('copies what the reader typed, not the stored body', () => {
    const bench = harness()
    const writeText = vi.fn(async () => {})
    installClipboard(writeText)
    show(bench.props())
    fireEvent.change(screen.getByLabelText('detail.body'), { target: { value: 'edited' } })

    fireEvent.click(screen.getByText('detail.copy'))

    expect(writeText).toHaveBeenCalledExactlyOnceWith('edited')
  })

  it('keeps its label when the host refuses the write', async () => {
    const bench = harness()
    installClipboard(vi.fn(async () => { throw new Error('denied') }))
    show(bench.props())

    fireEvent.click(screen.getByText('detail.copy'))

    await waitFor(() => { expect(screen.queryByText('detail.copied')).toBeNull() })
    expect(screen.getByText('detail.copy')).toBeDefined()
  })

  it('writes once while it is still reporting the first copy', async () => {
    const bench = harness()
    const writeText = vi.fn(async () => {})
    installClipboard(writeText)
    show(bench.props())

    fireEvent.click(screen.getByText('detail.copy'))
    await waitFor(() => { expect(screen.getByText('detail.copied')).toBeDefined() })
    fireEvent.click(screen.getByText('detail.copied'))

    expect(writeText).toHaveBeenCalledExactlyOnceWith('body')
  })

  it('stops reporting success once the copy feedback window passes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const bench = harness()
    installClipboard(vi.fn(async () => {}))
    show(bench.props())

    fireEvent.click(screen.getByText('detail.copy'))
    await waitFor(() => { expect(screen.getByText('detail.copied')).toBeDefined() })

    act(() => { vi.advanceTimersByTime(1000) })

    expect(screen.getByText('detail.copy')).toBeDefined()
  })

  it('offers no copy for a material with no text', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ noteId: noteId('n1'), kind: 'image', text: null, hasImage: true }))

    expect(screen.queryByText('detail.copy')).toBeNull()
  })
})
