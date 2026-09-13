// @vitest-environment jsdom
/**
 * What the panel draws from its store, and what its controls do.
 *
 * The store is real and the commands are the scripted face, so a click here
 * runs the same read path the browser runs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NotesPanel, sessionIntent } from '../src/client/NotesPanel.tsx'
import { NotesButton } from '../src/client/NotesButton.tsx'
import {
  harness, materialId, materialSummary, materials, noteId, sessionSummary, sessions, thread,
  unavailable,
} from './fixtures.client.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('notes panel', () => {
  it('offers to start a conversation while none exists', async () => {
    const bench = harness({ sessions: () => sessions([], [], null) })
    render(<NotesPanel {...bench.props()} />)

    expect(screen.getByText('panel.empty')).toBeDefined()
    fireEvent.click(screen.getByText('panel.create'))

    await waitFor(() => { expect(bench.remote.sessionCreate).toHaveBeenCalledTimes(1) })
  })

  it('draws the shown conversation, its count, and one row per material', async () => {
    const note = noteId('n1')
    const bench = harness({
      sessions: () => sessions([sessionSummary({ id: note, title: 'Notes · probe' })], [], note),
      materials: () => materials([
        materialSummary({ noteId: note, text: 'first' }),
        materialSummary({
          id: materialId('m2'),
          noteId: note,
          kind: 'image',
          text: null,
          hasImage: true,
        }),
      ]),
    })
    render(<NotesPanel {...bench.props()} />)

    await waitFor(() => { expect(screen.getByText('Notes · probe')).toBeDefined() })
    expect(screen.getByText('panel.materials(count=2)')).toBeDefined()
    expect(screen.getByText('first')).toBeDefined()
    // An image material has no text, so its row says what it is twice: once
    // where the text would be, and once as its source.
    expect(screen.getAllByText('source.image')).toHaveLength(2)
    expect(document.querySelectorAll('[data-notes-material]')).toHaveLength(2)
  })

  it('says a conversation has no materials yet', async () => {
    const note = noteId('n1')
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: note })], [], note) })
    render(<NotesPanel {...bench.props()} />)

    await waitFor(() => { expect(screen.getByText('panel.noMaterials')).toBeDefined() })
  })

  it('draws a trajectory material with its own source line', async () => {
    const note = noteId('n1')
    const bench = harness({
      sessions: () => sessions([sessionSummary({ id: note })], [], note),
      materials: () => materials([
        materialSummary({ noteId: note, source: { ...materialSummary().source, view: 'trajectory' } }),
      ]),
    })
    render(<NotesPanel {...bench.props()} />)

    await waitFor(() => { expect(screen.getByText('source.trajectory')).toBeDefined() })
  })

  it('draws a refusal instead of content', async () => {
    const bench = harness({ sessions: () => ({ ok: false, error: unavailable('socket closed') }) })
    render(<NotesPanel {...bench.props()} />)

    await waitFor(() => { expect(screen.getByText('error.remoteUnavailable(message=socket closed)')).toBeDefined() })
    expect(document.querySelector('[data-notes-failure]')).not.toBeNull()
    expect(screen.queryByText('panel.empty')).toBeNull()
  })

  it('reads again when the reader asks', async () => {
    const bench = harness({ sessions: () => sessions([], [], null) })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(bench.remote.sessionList).toHaveBeenCalledTimes(1) })

    fireEvent.click(screen.getByLabelText('panel.refresh'))

    await waitFor(() => { expect(bench.remote.sessionList).toHaveBeenCalledTimes(2) })
  })

  it('shows the panel title before any conversation exists', () => {
    const bench = harness({ sessions: () => sessions([], [], null) })
    render(<NotesPanel {...bench.props()} />)

    expect(screen.getByText('tab.title')).toBeDefined()
  })

  it('opens one material\'s detail from its row and closes it again', async () => {
    const note = noteId('n1')
    const bench = harness({
      sessions: () => sessions([sessionSummary({ id: note })], [], note),
      materials: () => materials([materialSummary({ noteId: note, text: 'row body' })]),
      thread: () => thread([{ role: 'user', text: 'row body', seq: 0 }]),
    })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(screen.getByText('row body')).toBeDefined() })

    fireEvent.click(screen.getByText('source.chat'))

    await waitFor(() => { expect(document.querySelector('[data-notes-detail]')).not.toBeNull() })
    expect(bench.remote.materialThread).toHaveBeenCalledExactlyOnceWith({ id: materialSummary().id })

    fireEvent.click(screen.getByLabelText('detail.back'))

    await waitFor(() => { expect(document.querySelector('[data-notes-detail]')).toBeNull() })
  })

  it('says a conversation has no materials yet in place of the list', async () => {
    const note = noteId('n1')
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: note })], [], note) })
    render(<NotesPanel {...bench.props()} />)

    await waitFor(() => { expect(screen.getByText('panel.noMaterials')).toBeDefined() })
  })

  it('starts another conversation from the navigation bar', async () => {
    const note = noteId('n1')
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: note })], [], note) })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(screen.getByLabelText('panel.create')).toBeDefined() })

    fireEvent.click(screen.getByLabelText('panel.create'))

    await waitFor(() => { expect(bench.remote.sessionCreate).toHaveBeenCalledTimes(1) })
  })

  it('switches to another conversation and restores an archived one', async () => {
    const first = sessionSummary({ id: noteId('n1'), title: 'Notes · one' })
    const second = sessionSummary({ id: noteId('n2'), title: 'Notes · two' })
    const stored = sessionSummary({ id: noteId('n3'), title: 'Notes · three', archivedAt: 1 })
    const bench = harness({
      sessions: () => sessions([first, second], [stored], first.id),
    })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(screen.getByText('Notes · one')).toBeDefined() })

    fireEvent.click(screen.getByText('Notes · one'))
    fireEvent.click(await screen.findByText('Notes · two'))

    await waitFor(() => { expect(bench.remote.sessionSelect).toHaveBeenCalledExactlyOnceWith({ id: second.id }) })

    fireEvent.click(screen.getByText('Notes · one'))
    fireEvent.click(await screen.findByText('panel.archivedItem(title=Notes · three)'))

    await waitFor(() => { expect(bench.remote.sessionRestore).toHaveBeenCalledExactlyOnceWith({ id: stored.id }) })
  })

  it('archives the conversation it shows', async () => {
    const note = noteId('n1')
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: note })], [], note) })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(screen.getByLabelText('panel.archiveSession')).toBeDefined() })

    fireEvent.click(screen.getByLabelText('panel.archiveSession'))

    await waitFor(() => { expect(bench.remote.sessionArchive).toHaveBeenCalledExactlyOnceWith({ id: note }) })
  })

  it('closes the conversation menu without choosing', async () => {
    const first = sessionSummary({ id: noteId('n1'), title: 'Notes · one' })
    const second = sessionSummary({ id: noteId('n2'), title: 'Notes · two' })
    const bench = harness({ sessions: () => sessions([first, second], [], first.id) })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(screen.getByText('Notes · one')).toBeDefined() })
    fireEvent.click(screen.getByText('Notes · one'))
    expect(await screen.findByText('Notes · two')).toBeDefined()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => { expect(screen.queryByText('Notes · two')).toBeNull() })
    expect(bench.remote.sessionSelect).not.toHaveBeenCalled()
  })

  it('treats a missing conversation pointer as no conversation yet', async () => {
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: noteId('n1') })], [], null) })
    render(<NotesPanel {...bench.props()} />)

    await waitFor(() => { expect(screen.getByText('panel.empty')).toBeDefined() })
  })

  it('reports a refused write over the content it left standing', async () => {
    const note = noteId('n1')
    const bench = harness({
      sessions: () => sessions([sessionSummary({ id: note })], [], note),
      materials: () => materials([materialSummary({ noteId: note })]),
    })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(screen.getByText('source.chat')).toBeDefined() })
    bench.remote.materialUpdate.mockResolvedValueOnce({
      ok: true,
      value: { ok: false, error: { code: 'material-submitted', id: materialSummary().id } },
    })

    bench.face.saveText(materialSummary().id, 'edited')

    await waitFor(() => { expect(document.querySelector('[data-notes-notice]')).not.toBeNull() })
    expect(screen.getByText('error.materialSubmitted')).toBeDefined()
    // The listing the refusal left standing stays: only a failed read replaces it.
    expect(screen.getByText('source.chat')).toBeDefined()
  })
})

describe('conversation menu entries', () => {
  const listed = [sessionSummary({ id: noteId('n1') })]
  const archived = [sessionSummary({ id: noteId('n2'), archivedAt: 1 })]

  it('opens a listed conversation', () => {
    expect(sessionIntent('n1', listed, archived)).toEqual({ kind: 'open', id: noteId('n1') })
  })

  it('restores an archived one', () => {
    expect(sessionIntent('n2', listed, archived)).toEqual({ kind: 'restore', id: noteId('n2') })
  })

  it('asks for nothing when the entry names no conversation', () => {
    expect(sessionIntent('gone', listed, archived)).toBeNull()
  })
})

describe('notes header control', () => {
  it('asks for the panel when pressed', () => {
    const bench = harness()
    const props = bench.buttonProps()
    render(<NotesButton {...props} />)

    fireEvent.click(screen.getByLabelText('header.openAria'))

    expect(props.open).toHaveBeenCalledTimes(1)
  })
})
