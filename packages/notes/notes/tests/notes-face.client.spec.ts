/**
 * The panel's commands: one read per mount, a forced re-read on demand, and a
 * refusal reported as itself instead of thrown.
 *
 * The Host here is a scripted Remote face, so every branch of the read — a
 * carrier failure, a business refusal on the material listing, a start that
 * fails — is reachable without a gateway.
 */
import { describe, expect, it } from 'vitest'
import { noteId, created, harness, materialSummary, materials, sessions, sessionSummary, unavailable } from './fixtures.client.ts'

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
