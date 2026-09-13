// @vitest-environment jsdom
/**
 * What the panel draws from its store, and what its controls do.
 *
 * The store is real and the commands are the scripted face, so a click here
 * runs the same read path the browser runs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NotesPanel } from '../src/client/NotesPanel.tsx'
import { NotesButton } from '../src/client/NotesButton.tsx'
import {
  harness, materialId, materialSummary, materials, noteId, sessionSummary, sessions, unavailable,
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
