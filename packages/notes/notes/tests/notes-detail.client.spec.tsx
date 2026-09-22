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

/** Fold the source card open, the way the head's toggle does. */
function openSource(): void {
  fireEvent.click(document.querySelector('[data-notes-source-toggle]') as Element)
}

/** Pick the head menu's copy entry. */
async function copyFromMenu(): Promise<void> {
  fireEvent.click(document.querySelector('[data-notes-detail-menu]') as Element)
  fireEvent.click(await screen.findByText('detail.copy'))
}

describe('material detail', () => {
  it('heads the pane with the title the material\'s row shows', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ title: '我的标题' }))

    expect(document.querySelector('[data-notes-material-title]')?.textContent).toBe('我的标题')
  })

  it('heads the pane with the body-derived title while no rename is stored', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ text: 'the body' }))

    expect(document.querySelector('[data-notes-material-title]')?.textContent).toBe('the body')
  })

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

  it('names where the material came from, behind the head\'s disclosure', () => {
    const bench = harness()
    show(bench.props())

    // The source card stays folded until the reader asks for it.
    expect(document.querySelector('[data-notes-source]')).toBeNull()

    openSource()

    expect(document.querySelector('[data-notes-source]')?.textContent).toContain('conversation «probe»')
    expect(screen.getByText('source.chat')).toBeDefined()
  })

  it('names a trajectory collection', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ source: { ...draft.source, view: 'trajectory' } }))

    openSource()

    expect(screen.getByText('source.trajectory')).toBeDefined()
  })

  it('names a screenshot collection where its text would be', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ noteId: noteId('n1'), kind: 'image', text: null, hasImage: true }))

    // Its body names it, and its folded-open source card does too.
    expect(screen.getAllByText('source.image')).toHaveLength(1)
    expect(screen.queryByLabelText('detail.body')).toBeNull()
    expect(document.querySelector('[data-notes-body]')?.textContent).toBe('source.image')

    openSource()

    expect(screen.getAllByText('source.image')).toHaveLength(2)
  })

  it('offers the source card a locate entry for a position the material recorded', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ noteId: noteId('n1'), text: 'body', source: source({ seq: sessionSeq(42) }) }))

    openSource()

    expect(document.querySelector('[data-notes-locate]')).not.toBeNull()
  })

  it('offers the source card a locate entry for a recorded tool call too', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ noteId: noteId('n1'), text: 'body', source: source({ callId: 'call-7' }) }))

    openSource()

    expect(document.querySelector('[data-notes-locate]')).not.toBeNull()
  })

  it('offers no locate entry for a material that recorded no position', () => {
    const bench = harness()
    show(bench.props())

    openSource()

    expect(document.querySelector('[data-notes-locate]')).toBeNull()
  })

  it('explains that a recorded source cannot be opened yet', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ noteId: noteId('n1'), text: 'body', source: source({ seq: sessionSeq(42) }) }))

    openSource()

    expect(document.querySelector('[data-notes-locate-hint]')).toBeNull()

    fireEvent.click(screen.getByText('detail.locate'))

    expect(document.querySelector('[data-notes-locate-hint]')?.textContent).toBe('detail.locateHint')
  })

  it('reports the reason a material failed', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ status: 'failed', error: 'inbox rejected' }))

    expect(screen.getByText('inbox rejected')).toBeDefined()
  })

  it('asks the Host to analyse, archive, and delete the material', async () => {
    const bench = harness()
    const props = bench.props()
    const analyze = vi.spyOn(props, 'analyze')
    const archive = vi.spyOn(props, 'archive')
    const remove = vi.spyOn(props, 'remove')
    show(props)

    // Analysis is the draft body's own control; archive and delete are the
    // head menu's row-level actions.
    fireEvent.click(screen.getByText('detail.analyze'))
    fireEvent.click(document.querySelector('[data-notes-detail-menu]') as Element)
    fireEvent.click(await screen.findByText('detail.archive'))
    fireEvent.click(document.querySelector('[data-notes-detail-menu]') as Element)
    fireEvent.click(await screen.findByText('detail.remove'))

    // Deleting confirms through the risk dialog.
    fireEvent.click(screen.getByText('detail.removeAcknowledge'))
    fireEvent.click(screen.getByText('detail.remove'))

    expect(analyze).toHaveBeenCalledExactlyOnceWith(draft.id)
    expect(archive).toHaveBeenCalledExactlyOnceWith(draft.id)
    expect(remove).toHaveBeenCalledExactlyOnceWith(draft.id)
  })

  it('restores an archived material from the head menu', async () => {
    const bench = harness()
    const props = bench.props()
    const restore = vi.spyOn(props, 'restore')
    show(props, materialSummary({ archivedAt: 1 }))

    fireEvent.click(document.querySelector('[data-notes-detail-menu]') as Element)
    fireEvent.click(await screen.findByText('panel.restore'))

    expect(restore).toHaveBeenCalledExactlyOnceWith(materialSummary().id)
  })

  it('closes the head menu without acting', async () => {
    const bench = harness()
    show(bench.props())

    fireEvent.click(document.querySelector('[data-notes-detail-menu]') as Element)
    expect(await screen.findByText('detail.archive')).toBeDefined()

    fireEvent.pointerDown(document.body)

    await vi.waitFor(() => { expect(screen.queryByText('detail.archive')).toBeNull() })
  })

  it('cancels a delete without writing', async () => {
    const bench = harness()
    const props = bench.props()
    const remove = vi.spyOn(props, 'remove')
    show(props)

    fireEvent.click(document.querySelector('[data-notes-detail-menu]') as Element)
    fireEvent.click(await screen.findByText('detail.remove'))
    expect(screen.getByText('detail.removeTitle')).toBeDefined()

    fireEvent.click(screen.getByText('list.cancel'))

    expect(remove).not.toHaveBeenCalled()
    expect(screen.queryByText('detail.removeTitle')).toBeNull()
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

  it('renders both sides of the thread as Markdown', () => {
    const bench = harness()
    show(bench.props(), draft, {
      thread: [
        { role: 'user', text: 'a **passage**', hasImage: false, seq: 0 },
        { role: 'assistant', text: '**Windows 通道**\n\n- 第一条\n- 第二条', hasImage: false, seq: 1 },
      ],
    })

    const answer = document.querySelector('[data-notes-row="assistant"]')
    // A model writes Markdown: emphasis and lists become elements.
    expect(answer?.querySelector('strong')?.textContent).toBe('Windows 通道')
    expect([...(answer?.querySelectorAll('li') ?? [])].map(item => item.textContent))
      .toEqual(['第一条', '第二条'])
    // The collected passage is Markdown too: a material is as likely to be a
    // document as it is to be prose.
    const own = document.querySelector('[data-notes-row="user"]')
    expect(own?.querySelector('strong')?.textContent).toBe('passage')
  })

  it('renders the submitted body as Markdown in the pane above the thread', () => {
    const bench = harness()
    show(bench.props(), materialSummary({
      noteId: noteId('n1'), text: '## 小节\n\n- 一条', submitted: true, status: 'analyzed',
    }))

    const body = document.querySelector('[data-notes-body]')
    expect(body?.querySelector('h2')?.textContent).toBe('小节')
    expect([...(body?.querySelectorAll('li') ?? [])].map(item => item.textContent)).toEqual(['一条'])
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

    // The template lives in the source card, folded with it.
    expect(document.querySelector('[data-notes-action-template]')).toBeNull()
    openSource()

    expect(document.querySelector('[data-notes-action-template="translate"]')?.textContent)
      .toContain('不改变语句结构，翻译下列内容：')
  })

  it('folds the action template to one line until the reader expands it', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ noteId: noteId('n1'), text: 'body', action: 'translate' }), {
      actions: [translate],
    })

    openSource()

    const card = document.querySelector('[data-notes-action-template="translate"]') as Element
    expect(card.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('detail.templateExpand')).toBeDefined()

    fireEvent.click(card)

    expect(card.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('detail.templateCollapse')).toBeDefined()
  })

  it('echoes nothing for an action the configuration dropped', () => {
    const bench = harness()
    show(bench.props(), materialSummary({ noteId: noteId('n1'), text: 'body', action: 'gone' }), {
      actions: [translate],
    })

    openSource()

    expect(document.querySelector('[data-notes-action-template]')).toBeNull()
  })

  it('copies the body it shows and reports the write', async () => {
    const bench = harness()
    const writeText = vi.fn(async () => {})
    installClipboard(writeText)
    show(bench.props())

    await copyFromMenu()

    await waitFor(() => { expect(screen.getByText('detail.copied')).toBeDefined() })
    expect(writeText).toHaveBeenCalledExactlyOnceWith('body')
  })

  it('copies what the reader typed, not the stored body', async () => {
    const bench = harness()
    const writeText = vi.fn(async () => {})
    installClipboard(writeText)
    show(bench.props())
    fireEvent.change(screen.getByLabelText('detail.body'), { target: { value: 'edited' } })

    await copyFromMenu()

    expect(writeText).toHaveBeenCalledExactlyOnceWith('edited')
  })

  it('keeps its label when the host refuses the write', async () => {
    const bench = harness()
    installClipboard(vi.fn(async () => { throw new Error('denied') }))
    show(bench.props())

    await copyFromMenu()

    await waitFor(() => { expect(screen.queryByText('detail.copied')).toBeNull() })
    // The menu still offers the copy: a refused write reports nothing.
    fireEvent.click(document.querySelector('[data-notes-detail-menu]') as Element)
    expect(await screen.findByText('detail.copy')).toBeDefined()
  })

  it('writes once while it is still reporting the first copy', async () => {
    const bench = harness()
    const writeText = vi.fn(async () => {})
    installClipboard(writeText)
    show(bench.props())

    await copyFromMenu()
    await waitFor(() => { expect(screen.getByText('detail.copied')).toBeDefined() })
    await copyFromMenu()

    expect(writeText).toHaveBeenCalledExactlyOnceWith('body')
  })

  it('stops reporting success once the copy feedback window passes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const bench = harness()
    installClipboard(vi.fn(async () => {}))
    show(bench.props())

    await copyFromMenu()
    await waitFor(() => { expect(document.querySelector('[data-notes-copied]')).not.toBeNull() })

    act(() => { vi.advanceTimersByTime(1000) })

    expect(document.querySelector('[data-notes-copied]')).toBeNull()
  })

  it('offers no copy for a material with no text', async () => {
    const bench = harness()
    show(bench.props(), materialSummary({ noteId: noteId('n1'), kind: 'image', text: null, hasImage: true }))

    fireEvent.click(document.querySelector('[data-notes-detail-menu]') as Element)

    // The menu keeps its other entries; only the copy is absent.
    expect(await screen.findByText('detail.archive')).toBeDefined()
    expect(screen.queryByText('detail.copy')).toBeNull()
  })
})
