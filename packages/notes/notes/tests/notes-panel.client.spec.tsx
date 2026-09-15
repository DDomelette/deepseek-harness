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
import { payloadOf } from '../src/client/image.ts'
import { NotesButton } from '../src/client/NotesButton.tsx'
import {
  harness, materialId, materialSummary, materials, noteId, sessionSummary, sessions, thread,
  unavailable,
} from './fixtures.client.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** One clipboard item holding an image file. */
function imageItem(type: string, file: File): { kind: string; type: string; getAsFile: () => File } {
  return { kind: 'file', type, getAsFile: () => file }
}

/**
 * Paste a clipboard carrying these items into the panel.
 * @param items - the clipboard's items as the browser reports them.
 * @returns whether the paste kept its default behavior.
 */
function paste(items: readonly unknown[]): boolean {
  return fireEvent.paste(document.querySelector('[data-notes-panel]') as Element, {
    clipboardData: { items },
  })
}

describe('notes panel', () => {
  it('offers to start a conversation while none exists', async () => {
    const bench = harness({ sessions: () => sessions([], [], null) })
    render(<NotesPanel {...bench.props()} />)

    expect(screen.getByText('panel.empty')).toBeDefined()
    fireEvent.click(document.querySelector('[data-notes-create]') as Element)

    await waitFor(() => { expect(bench.remote.sessionCreate).toHaveBeenCalledTimes(1) })
  })

  it('reads the settings section when it opens, so a row can name its action', async () => {
    const note = noteId('n1')
    const bench = harness({
      sessions: () => sessions([sessionSummary({ id: note })], [], note),
      materials: () => materials([materialSummary({ noteId: note, text: 'body', action: 'translate' })]),
    })
    render(<NotesPanel {...bench.props()} />)

    await waitFor(() => { expect(document.querySelector('[data-notes-action="translate"]')).not.toBeNull() })
    expect(bench.remote.settingsRead).toHaveBeenCalledTimes(1)
  })

  it('keeps a label on every navigation control', async () => {
    const note = noteId('n1')
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: note })], [], note) })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(document.querySelector('[data-notes-refresh]')).not.toBeNull() })

    // The container query hides these below 500px; above it they are the control's text.
    expect(document.querySelector('[data-notes-refresh]')?.textContent).toBe('panel.refresh')
    expect(document.querySelector('[data-notes-settings-open]')?.textContent).toBe('panel.settings')
    expect(document.querySelector('[data-notes-present="float"]')?.textContent).toBe('panel.float')
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
      thread: () => thread([{ role: 'user', text: 'row body', hasImage: false, seq: 0 }]),
    })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(screen.getByText('row body')).toBeDefined() })

    fireEvent.click(screen.getByText('source.chat'))

    await waitFor(() => { expect(document.querySelector('[data-notes-detail]')).not.toBeNull() })
    expect(bench.remote.materialThread).toHaveBeenCalledExactlyOnceWith({ id: materialSummary().id })

    fireEvent.click(screen.getByLabelText('detail.back'))

    await waitFor(() => { expect(document.querySelector('[data-notes-detail]')).toBeNull() })
  })

  it('keeps an unsaved draft with the material it was typed in', async () => {
    const note = noteId('n1')
    const bench = harness({
      sessions: () => sessions([sessionSummary({ id: note })], [], note),
      materials: () => materials([
        materialSummary({ noteId: note, text: 'first body' }),
        materialSummary({ noteId: note, id: materialId('m2'), text: 'second body' }),
      ]),
      thread: () => thread([]),
    })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(screen.getByText('first body')).toBeDefined() })

    fireEvent.click(screen.getAllByText('source.chat')[0] as HTMLElement)
    await waitFor(() => { expect(document.querySelector('[data-notes-detail]')).not.toBeNull() })
    fireEvent.change(screen.getByLabelText('detail.body'), { target: { value: 'unsaved edit' } })

    // The list stays beside the open detail, so the second row is clicked with
    // the first material's draft still standing in the pane.
    fireEvent.click(screen.getAllByText('source.chat')[1] as HTMLElement)

    const editor = await screen.findByLabelText('detail.body')
    expect((editor as HTMLTextAreaElement).value).toBe('second body')
    expect(screen.queryByText('detail.save')).toBeNull()
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

  it('floats the panel out of the column and docks it back', async () => {
    const docked = harness()
    render(<NotesPanel {...docked.props()} />)
    fireEvent.click(screen.getByLabelText('panel.float'))
    expect(docked.frame.float).toHaveBeenCalledExactlyOnceWith('tab-1')
    cleanup()

    const floating = harness({ floating: true })
    render(<NotesPanel {...floating.props()} />)
    expect(document.querySelector('[data-notes-present="dock"]')).not.toBeNull()
    fireEvent.click(screen.getByLabelText('panel.dock'))
    expect(floating.frame.dock).toHaveBeenCalledExactlyOnceWith('pane-1')
  })

  it('opens the settings card and reads the section for it', async () => {
    const bench = harness()
    render(<NotesPanel {...bench.props()} />)

    fireEvent.click(screen.getByLabelText('panel.settings'))

    await waitFor(() => { expect(document.querySelector('[data-notes-settings]')).not.toBeNull() })
    expect(bench.remote.settingsRead).toHaveBeenCalledTimes(1)
  })

  it('closes the settings card again', async () => {
    const bench = harness()
    render(<NotesPanel {...bench.props()} />)
    fireEvent.click(screen.getByLabelText('panel.settings'))
    await waitFor(() => { expect(document.querySelector('[data-notes-settings]')).not.toBeNull() })

    fireEvent.click(document.querySelector('[aria-label="settings.close"]') as Element)

    await waitFor(() => { expect(document.querySelector('[data-notes-settings]')).toBeNull() })
  })

  it('collects a picked screenshot as its own material', async () => {
    const note = noteId('n1')
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: note })], [], note) })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(document.querySelector('[data-notes-image-input]')).not.toBeNull() })
    const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })

    fireEvent.change(document.querySelector('[data-notes-image-input]') as Element, { target: { files: [file] } })

    await waitFor(() => { expect(bench.remote.materialAddImage).toHaveBeenCalledTimes(1) })
    expect(bench.remote.materialAddImage.mock.calls[0]?.[0]).toMatchObject({
      noteId: note,
      // The bytes travel as canonical base64, without the data-URL prefix.
      data: 'AQID',
      mediaType: 'image/png',
      action: null,
      source: { view: 'chat', label: 'panel.image', seq: null, messageId: null, callId: null },
    })
  })

  it('refuses a format the attachment store does not take, without asking the Host', async () => {
    const note = noteId('n1')
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: note })], [], note) })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(document.querySelector('[data-notes-image-input]')).not.toBeNull() })
    const file = new File([new Uint8Array([1])], 'sketch.bmp', { type: 'image/bmp' })

    fireEvent.change(document.querySelector('[data-notes-image-input]') as Element, { target: { files: [file] } })

    await waitFor(() => { expect(document.querySelector('[data-notes-notice="image-format"]')).not.toBeNull() })
    expect(bench.remote.materialAddImage).not.toHaveBeenCalled()
  })

  it('collects a pasted screenshot the same way the picker does', async () => {
    const note = noteId('n1')
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: note })], [], note) })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(document.querySelector('[data-notes-panel]')).not.toBeNull() })
    const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })

    const kept = paste([imageItem('image/png', file)])

    await waitFor(() => { expect(bench.remote.materialAddImage).toHaveBeenCalledTimes(1) })
    expect(bench.remote.materialAddImage.mock.calls[0]?.[0]).toMatchObject({
      noteId: note,
      data: 'AQID',
      mediaType: 'image/png',
      action: null,
      // A pasted screenshot belongs to no row, exactly like a picked one.
      source: { view: 'chat', label: 'panel.image', seq: null, messageId: null, callId: null },
    })
    // The panel consumed the image, so the browser's own paste does nothing.
    expect(kept).toBe(false)
  })

  it('leaves every paste that carries no image alone', async () => {
    const note = noteId('n1')
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: note })], [], note) })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(document.querySelector('[data-notes-panel]')).not.toBeNull() })

    const kept = paste([{ kind: 'string', type: 'text/plain', getAsFile: () => null }])

    expect(bench.remote.materialAddImage).not.toHaveBeenCalled()
    expect(kept).toBe(true)
  })

  it('collects the first image of a paste carrying several', async () => {
    const note = noteId('n1')
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: note })], [], note) })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(document.querySelector('[data-notes-panel]')).not.toBeNull() })
    const first = new File([new Uint8Array([1, 2, 3])], 'first.png', { type: 'image/png' })
    const second = new File([new Uint8Array([4, 5, 6])], 'second.png', { type: 'image/png' })

    paste([imageItem('image/png', first), imageItem('image/png', second)])

    await waitFor(() => { expect(bench.remote.materialAddImage).toHaveBeenCalledTimes(1) })
    expect(bench.remote.materialAddImage.mock.calls[0]?.[0]).toMatchObject({ data: 'AQID' })
  })

  it('refuses a pasted format the attachment store does not take', async () => {
    const note = noteId('n1')
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: note })], [], note) })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(document.querySelector('[data-notes-panel]')).not.toBeNull() })
    const file = new File([new Uint8Array([1])], 'sketch.bmp', { type: 'image/bmp' })

    paste([imageItem('image/bmp', file)])

    await waitFor(() => { expect(document.querySelector('[data-notes-notice="image-format"]')).not.toBeNull() })
    expect(bench.remote.materialAddImage).not.toHaveBeenCalled()
  })

  it('reports a pasted image the browser cannot read', async () => {
    const note = noteId('n1')
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: note })], [], note) })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(document.querySelector('[data-notes-panel]')).not.toBeNull() })
    vi.stubGlobal('FileReader', class {
      onerror: (() => void) | null = null
      onload: (() => void) | null = null
      readAsDataURL(): void { this.onerror?.() }
    })
    const file = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })

    paste([imageItem('image/png', file)])

    await waitFor(() => { expect(document.querySelector('[data-notes-notice="image-unreadable"]')).not.toBeNull() })
    expect(bench.remote.materialAddImage).not.toHaveBeenCalled()
  })

  it('leaves a paste whose clipboard entry holds no file alone', async () => {
    const note = noteId('n1')
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: note })], [], note) })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(document.querySelector('[data-notes-panel]')).not.toBeNull() })

    const kept = paste([{ kind: 'file', type: 'image/png', getAsFile: () => null }])

    expect(bench.remote.materialAddImage).not.toHaveBeenCalled()
    expect(kept).toBe(true)
  })

  it('reports a pasted screenshot the Host refused', async () => {
    const note = noteId('n1')
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: note })], [], note) })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(document.querySelector('[data-notes-panel]')).not.toBeNull() })
    bench.remote.materialAddImage.mockResolvedValueOnce({
      ok: true,
      value: { ok: false, error: { code: 'attachments-unavailable' } },
    })
    const file = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })

    paste([imageItem('image/png', file)])

    await waitFor(() => {
      expect(document.querySelector('[data-notes-notice="attachments-unavailable"]')).not.toBeNull()
    })
  })

  it('opens the image picker from the navigation bar', async () => {    const note = noteId('n1')
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: note })], [], note) })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(screen.getByLabelText('panel.addImage')).toBeDefined() })
    const input = document.querySelector('[data-notes-image-input]') as HTMLInputElement
    const click = vi.spyOn(input, 'click')

    fireEvent.click(screen.getByLabelText('panel.addImage'))

    expect(click).toHaveBeenCalledTimes(1)
  })

  it('ignores a change that carries no file', async () => {
    const note = noteId('n1')
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: note })], [], note) })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(document.querySelector('[data-notes-image-input]')).not.toBeNull() })

    fireEvent.change(document.querySelector('[data-notes-image-input]') as Element)

    expect(bench.remote.materialAddImage).not.toHaveBeenCalled()
    expect(document.querySelector('[data-notes-notice]')).toBeNull()
  })

  it('reports an image the browser cannot read', async () => {    const note = noteId('n1')
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: note })], [], note) })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(document.querySelector('[data-notes-image-input]')).not.toBeNull() })
    // A reader that fails instead of loading, which is what a browser does for
    // bytes it cannot decode as a data URL.
    vi.stubGlobal('FileReader', class {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL(): void { this.onerror?.() }
    })
    const file = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })

    fireEvent.change(document.querySelector('[data-notes-image-input]') as Element, { target: { files: [file] } })

    await waitFor(() => { expect(document.querySelector('[data-notes-notice="image-unreadable"]')).not.toBeNull() })
    expect(bench.remote.materialAddImage).not.toHaveBeenCalled()
  })

  it('reports a screenshot the Host refused', async () => {
    const note = noteId('n1')
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: note })], [], note) })
    render(<NotesPanel {...bench.props()} />)
    await waitFor(() => { expect(document.querySelector('[data-notes-image-input]')).not.toBeNull() })
    bench.remote.materialAddImage.mockResolvedValueOnce({
      ok: true,
      value: { ok: false, error: { code: 'attachments-unavailable' } },
    })
    const file = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })

    fireEvent.change(document.querySelector('[data-notes-image-input]') as Element, { target: { files: [file] } })

    await waitFor(() => {
      expect(document.querySelector('[data-notes-notice="attachments-unavailable"]')).not.toBeNull()
    })
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

describe('collected image payloads', () => {
  it('takes the bytes out of a data URL', () => {
    expect(payloadOf('data:image/png;base64,AQID')).toBe('AQID')
  })

  it('takes nothing from a read that produced bytes instead', () => {
    expect(payloadOf(new ArrayBuffer(3))).toBeNull()
    expect(payloadOf(null)).toBeNull()
  })

  it('takes nothing from a string that carries no payload', () => {
    expect(payloadOf('not a data URL')).toBeNull()
  })
})

describe('conversation menu entries', () => {  const listed = [sessionSummary({ id: noteId('n1') })]
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
