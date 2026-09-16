/**
 * The panel's commands: one read per mount, a forced re-read on demand, and a
 * refusal reported as itself instead of thrown.
 *
 * The Host here is a scripted Remote face, so every branch of the read — a
 * carrier failure, a business refusal on the material listing, a start that
 * fails — is reachable without a gateway.
 */
import { describe, expect, it } from 'vitest'
import {
  created, harness, materialId, materialSummary, materials, noteId, sessionSummary, sessions,
  source, thread, unavailable,
} from './fixtures.client.ts'

/** Let the command's promise chain settle. */
async function settle(): Promise<void> {
  for (let step = 0; step < 4; step += 1) await Promise.resolve()
}

describe('notes panel commands', () => {
  it('reads the conversations and then the shown conversation\'s materials', async () => {
    const note = noteId('n1')
    const bench = harness({
      sessions: () => sessions([sessionSummary({ id: note })], [], note),
      materials: () => materials([materialSummary({ noteId: note })]),
    })

    bench.face.load()
    await settle()

    expect(bench.remote.sessionList).toHaveBeenCalledTimes(1)
    expect(bench.remote.materialList).toHaveBeenCalledExactlyOnceWith({ noteId: note })
    expect(bench.instance.getSnapshot().materials).toHaveLength(1)
    expect(bench.instance.getSnapshot().activeId).toBe(note)
  })

  it('reads no materials while no conversation exists', async () => {
    const bench = harness({ sessions: () => sessions([], [], null) })

    bench.face.load()
    await settle()

    expect(bench.remote.materialList).not.toHaveBeenCalled()
    expect(bench.instance.getSnapshot().loaded).toBe(true)
    expect(bench.instance.getSnapshot().materials).toEqual([])
  })

  it('reads nothing again while an answer is already held', async () => {
    const bench = harness()

    bench.face.load()
    await settle()
    bench.face.load()
    await settle()

    expect(bench.remote.sessionList).toHaveBeenCalledTimes(1)
  })

  it('reads again when the reader asks for a refresh', async () => {
    const bench = harness()

    bench.face.load()
    await settle()
    bench.face.refresh()
    await settle()

    expect(bench.remote.sessionList).toHaveBeenCalledTimes(2)
  })

  it('ignores a second read while one is in flight', async () => {
    const bench = harness()

    bench.face.load()
    bench.face.refresh()
    await settle()

    expect(bench.remote.sessionList).toHaveBeenCalledTimes(1)
  })

  it('reports a carrier failure on the conversation listing', async () => {
    const bench = harness({ sessions: () => ({ ok: false, error: unavailable('socket closed') }) })

    bench.face.load()
    await settle()

    expect(bench.instance.getSnapshot().failure).toEqual({
      code: 'remote-unavailable',
      message: 'socket closed',
    })
    expect(bench.instance.getSnapshot().loaded).toBe(false)
  })

  it('reports a carrier failure on the material listing', async () => {
    const note = noteId('n1')
    const bench = harness({
      sessions: () => sessions([sessionSummary({ id: note })], [], note),
      materials: () => ({ ok: false, error: unavailable('socket closed') }),
    })

    bench.face.load()
    await settle()

    expect(bench.instance.getSnapshot().failure?.code).toBe('remote-unavailable')
  })

  it('reports the Host\'s own refusal on the material listing', async () => {
    const note = noteId('n1')
    const bench = harness({
      sessions: () => sessions([sessionSummary({ id: note })], [], note),
      materials: () => ({ ok: true, value: { ok: false, error: { code: 'session-not-found', id: note } } }),
    })

    bench.face.load()
    await settle()

    expect(bench.instance.getSnapshot().failure).toEqual({ code: 'session-not-found', id: note })
  })

  it('starts a conversation and reads it back', async () => {
    const bench = harness({
      create: () => created(noteId('n2')),
      sessions: () => sessions([sessionSummary({ id: noteId('n2') })], [], noteId('n2')),
    })

    bench.face.createConversation()
    await settle()

    expect(bench.remote.sessionCreate).toHaveBeenCalledTimes(1)
    expect(bench.remote.sessionList).toHaveBeenCalledTimes(1)
    expect(bench.instance.getSnapshot().activeId).toBe(noteId('n2'))
  })

  it('reports a carrier failure while starting a conversation', async () => {
    const bench = harness({ create: () => ({ ok: false, error: unavailable('socket closed') }) })

    bench.face.createConversation()
    await settle()

    expect(bench.instance.getSnapshot().failure?.code).toBe('remote-unavailable')
    expect(bench.remote.sessionList).not.toHaveBeenCalled()
  })

  it('reports the Host\'s refusal while starting a conversation', async () => {
    const bench = harness({
      create: () => ({ ok: true, value: { ok: false, error: { code: 'workspace-missing' } } }),
    })

    bench.face.createConversation()
    await settle()

    expect(bench.instance.getSnapshot().failure).toEqual({ code: 'workspace-missing' })
    expect(bench.remote.sessionList).not.toHaveBeenCalled()
  })
})

describe('notes panel detail commands', () => {
  it('reads the thread of the material it opens', async () => {
    const bench = harness({ thread: () => thread([{ role: 'user', text: 'body', hasImage: false, seq: 0 }]) })

    bench.face.select(materialId('m1'))
    await settle()

    expect(bench.instance.getSnapshot().selected).toBe(materialId('m1'))
    expect(bench.remote.materialThread).toHaveBeenCalledExactlyOnceWith({ id: materialId('m1') })
    expect(bench.instance.getSnapshot().thread)
      .toEqual([{ role: 'user', text: 'body', hasImage: false, seq: 0 }])
  })

  it('re-reads the open detail along with everything else on a refresh', async () => {
    const note = noteId('n1')
    const bench = harness({
      sessions: () => sessions([sessionSummary({ id: note })], [], note),
      materials: () => materials([materialSummary({ noteId: note })]),
      thread: () => thread([{ role: 'user', text: 'body', hasImage: false, seq: 0 }]),
    })
    bench.face.load()
    await settle()
    bench.face.select(materialId('m1'))
    await settle()
    expect(bench.remote.materialThread).toHaveBeenCalledTimes(1)

    // The control promises to re-read everything the panel shows, and the open
    // detail is part of that: an answer that arrived since it was drawn is only
    // visible through this read.
    bench.face.refresh()
    await settle()

    expect(bench.remote.materialThread).toHaveBeenCalledTimes(2)
  })

  it('keeps a late thread answer out of the detail the reader moved to', async () => {
    const note = noteId('n1')
    const bench = harness({
      sessions: () => sessions([sessionSummary({ id: note })], [], note),
      materials: () => materials([
        materialSummary({ noteId: note, text: 'first' }),
        materialSummary({ noteId: note, id: materialId('m2'), text: 'second' }),
      ]),
    })
    const answers: Array<(result: ReturnType<typeof thread>) => void> = []
    bench.remote.materialThread.mockImplementation(() => new Promise((resolve) => {
      answers.push(resolve)
    }))

    bench.face.select(materialId('m1'))
    await settle()
    bench.face.select(materialId('m2'))
    await settle()

    // The first material's answer arrives after the reader moved on: it belongs
    // to a detail that is no longer open.
    answers[1]?.(thread([{ role: 'assistant', text: 'second answer', hasImage: false, seq: 1 }]))
    await settle()
    answers[0]?.(thread([{ role: 'assistant', text: 'first answer', hasImage: false, seq: 0 }]))
    await settle()

    expect(bench.instance.getSnapshot().thread)
      .toEqual([{ role: 'assistant', text: 'second answer', hasImage: false, seq: 1 }])
  })

  it('closes the detail without reading a thread', async () => {
    const bench = harness()

    bench.face.select(null)
    await settle()

    expect(bench.instance.getSnapshot().selected).toBeNull()
    expect(bench.remote.materialThread).not.toHaveBeenCalled()
  })

  it('reports a carrier failure while reading a thread', async () => {
    const bench = harness({ thread: () => ({ ok: false, error: unavailable('socket closed') }) })

    bench.face.select(materialId('m1'))
    await settle()

    expect(bench.instance.getSnapshot().threadFailure?.code).toBe('remote-unavailable')
  })

  it('reports the Host\'s refusal while reading a thread', async () => {
    const bench = harness({
      thread: () => ({ ok: true, value: { ok: false, error: { code: 'session-not-live', id: noteId('n1') } } }),
    })

    bench.face.select(materialId('m1'))
    await settle()

    expect(bench.instance.getSnapshot().threadFailure).toEqual({ code: 'session-not-live', id: noteId('n1') })
  })

  it('re-reads the open detail after a write lands', async () => {
    const bench = harness({
      sessions: () => sessions([sessionSummary({ id: noteId('n1') })], [], noteId('n1')),
      materials: () => materials([materialSummary({ noteId: noteId('n1') })]),
    })
    bench.face.select(materialId('m1'))
    await settle()

    bench.face.analyze(materialId('m1'))
    await settle()

    expect(bench.remote.materialAnalyze).toHaveBeenCalledExactlyOnceWith({ id: materialId('m1') })
    expect(bench.remote.materialThread).toHaveBeenCalledTimes(2)
    expect(bench.instance.getSnapshot().notice).toBeUndefined()
  })

  it('reports a carrier failure from a write', async () => {
    const bench = harness()
    bench.remote.materialUpdate.mockResolvedValueOnce({ ok: false, error: unavailable('socket closed') })

    bench.face.saveText(materialId('m1'), 'edited')
    await settle()

    expect(bench.instance.getSnapshot().notice?.code).toBe('remote-unavailable')
  })

  it('reports the Host\'s refusal from a write', async () => {
    const bench = harness()
    bench.remote.materialUpdate.mockResolvedValueOnce({
      ok: true,
      value: { ok: false, error: { code: 'material-submitted', id: materialId('m1') } },
    })

    bench.face.saveText(materialId('m1'), 'edited')
    await settle()

    expect(bench.instance.getSnapshot().notice).toEqual({ code: 'material-submitted', id: materialId('m1') })
  })

  it('closes the detail when a write removes the material it showed', async () => {
    const bench = harness()
    bench.face.select(materialId('m1'))
    await settle()

    bench.face.remove(materialId('m1'))
    await settle()

    expect(bench.instance.getSnapshot().selected).toBeNull()
    expect(bench.remote.materialRemove).toHaveBeenCalledExactlyOnceWith({ id: materialId('m1') })
  })

  it('closes the detail when the Host no longer lists the material', async () => {
    const listed = { value: true }
    const bench = harness({
      sessions: () => sessions([sessionSummary({ id: noteId('n1') })], [], noteId('n1')),
      materials: () => materials(listed.value ? [materialSummary({ noteId: noteId('n1') })] : []),
    })
    bench.face.load()
    await settle()
    bench.face.select(materialId('m1'))
    await settle()

    listed.value = false
    bench.face.refresh()
    await settle()

    expect(bench.instance.getSnapshot().selected).toBeNull()
    expect(bench.instance.getSnapshot().thread).toEqual([])
  })

  it('applies a reorder to the conversation it last read', async () => {
    const note = noteId('n1')
    const bench = harness({
      sessions: () => sessions([sessionSummary({ id: note })], [], note),
      materials: () => materials([materialSummary({ noteId: note })]),
    })
    bench.face.load()
    await settle()

    bench.face.reorder([materialId('m1')])
    await settle()

    expect(bench.remote.materialReorder)
      .toHaveBeenCalledExactlyOnceWith({ noteId: note, orderedIds: [materialId('m1')] })
  })

  it('restores an archived material', async () => {
    const bench = harness()

    bench.face.restore(materialId('m1'))
    await settle()

    expect(bench.remote.materialRestore).toHaveBeenCalledExactlyOnceWith({ id: materialId('m1') })
  })
})

describe('notes collection commands', () => {
  it('collects into the conversation the Host already shows', async () => {
    const note = noteId('n1')
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: note })], [], note) })

    await expect(bench.face.collect('a passage', null, source())).resolves.toBeNull()

    expect(bench.remote.sessionCreate).not.toHaveBeenCalled()
    expect(bench.remote.materialAddText).toHaveBeenCalledExactlyOnceWith({
      noteId: note,
      text: 'a passage',
      source: source(),
      action: null,
    })
  })

  it('reports a carrier failure on the conversation listing', async () => {
    const bench = harness({ sessions: () => ({ ok: false, error: unavailable('socket closed') }) })

    await expect(bench.face.collect('a passage', null, source()))
      .resolves.toEqual({ code: 'remote-unavailable', message: 'socket closed' })
    expect(bench.remote.materialAddText).not.toHaveBeenCalled()
  })

  it('reports a carrier failure while starting the first conversation', async () => {
    const bench = harness({
      sessions: () => sessions([], [], null),
      create: () => ({ ok: false, error: unavailable('socket closed') }),
    })

    await expect(bench.face.collect('a passage', null, source()))
      .resolves.toEqual({ code: 'remote-unavailable', message: 'socket closed' })
  })

  it('reports the Host\'s refusal while starting the first conversation', async () => {
    const bench = harness({
      sessions: () => sessions([], [], null),
      create: () => ({ ok: true, value: { ok: false, error: { code: 'workspace-missing' } } }),
    })

    await expect(bench.face.collect('a passage', null, source()))
      .resolves.toEqual({ code: 'workspace-missing' })
  })

  it('adds a screenshot to the conversation the Host already shows', async () => {
    const note = noteId('n1')
    const bench = harness({ sessions: () => sessions([sessionSummary({ id: note })], [], note) })

    await expect(bench.face.addImage('AQID', 'image/png', source(), 'translate')).resolves.toBeNull()

    expect(bench.remote.materialAddImage).toHaveBeenCalledExactlyOnceWith({
      noteId: note,
      data: 'AQID',
      mediaType: 'image/png',
      source: source(),
      action: 'translate',
    })
  })

  it('reports a carrier failure while adding a screenshot', async () => {
    const bench = harness()
    bench.remote.materialAddImage.mockResolvedValueOnce({ ok: false, error: unavailable('socket closed') })

    await expect(bench.face.addImage('AQID', 'image/png', source(), null))
      .resolves.toEqual({ code: 'remote-unavailable', message: 'socket closed' })
  })

  it('reports the Host\'s refusal while adding a screenshot', async () => {
    const bench = harness()
    bench.remote.materialAddImage.mockResolvedValueOnce({
      ok: true,
      value: { ok: false, error: { code: 'attachments-unavailable' } },
    })

    await expect(bench.face.addImage('AQID', 'image/png', source(), null))
      .resolves.toEqual({ code: 'attachments-unavailable' })
  })

  it('reports a refusal while starting the conversation a screenshot needs', async () => {
    const bench = harness({
      sessions: () => sessions([], [], null),
      create: () => ({ ok: true, value: { ok: false, error: { code: 'workspace-missing' } } }),
    })

    await expect(bench.face.addImage('AQID', 'image/png', source(), null))
      .resolves.toEqual({ code: 'workspace-missing' })
    expect(bench.remote.materialAddImage).not.toHaveBeenCalled()
  })
})

describe('notes directory picking', () => {
  it('answers the path the host\'s chooser returned', async () => {
    const bench = harness()

    await expect(bench.face.pickDirectory()).resolves.toEqual({ kind: 'picked', path: '/work/chosen' })

    expect(bench.directoryPicker.pick).toHaveBeenCalledTimes(1)
  })

  it('answers a cancelled chooser as a cancellation, reporting nothing', async () => {
    const bench = harness()
    bench.directoryPicker.pick.mockResolvedValueOnce({ ok: true, value: null })

    await expect(bench.face.pickDirectory()).resolves.toEqual({ kind: 'cancelled' })

    expect(bench.instance.getSnapshot().settingsFailure).toBeUndefined()
  })

  it('answers a deployment whose picker serves no native chooser without reporting a failure', async () => {
    const bench = harness()
    bench.directoryPicker.pick.mockResolvedValueOnce({ ok: false, error: unavailable('no chooser') })

    // The card browses instead, so this is not an error state.
    await expect(bench.face.pickDirectory()).resolves.toEqual({ kind: 'unavailable' })

    expect(bench.instance.getSnapshot().settingsFailure).toBeUndefined()
  })

  it('lists the level the browser asks for', async () => {
    const bench = harness()

    await expect(bench.face.listDirectories('/work')).resolves.toMatchObject({ path: '/work' })

    expect(bench.directoryPicker.list).toHaveBeenCalledExactlyOnceWith('/work')
  })

  it('lists the host home when the browser does not name a level', async () => {
    const bench = harness()

    await expect(bench.face.listDirectories(null)).resolves.toMatchObject({ path: '/work' })

    expect(bench.directoryPicker.list).toHaveBeenCalledExactlyOnceWith(undefined)
  })

  it('reports a level the host cannot read', async () => {
    const bench = harness()
    bench.directoryPicker.list.mockResolvedValueOnce({ ok: false, error: unavailable('unreadable') })

    await expect(bench.face.listDirectories(null)).resolves.toBeNull()

    expect(bench.instance.getSnapshot().settingsFailure).toEqual({ code: 'directory-unavailable' })
  })
})
