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
  thread, unavailable,
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
    const bench = harness({ thread: () => thread([{ role: 'user', text: 'body', seq: 0 }]) })

    bench.face.select(materialId('m1'))
    await settle()

    expect(bench.instance.getSnapshot().selected).toBe(materialId('m1'))
    expect(bench.remote.materialThread).toHaveBeenCalledExactlyOnceWith({ id: materialId('m1') })
    expect(bench.instance.getSnapshot().thread).toEqual([{ role: 'user', text: 'body', seq: 0 }])
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
