import { describe, expect, it, vi } from 'vitest'
import type { SessionPinsSnapshot } from '@deepseek-ai/dsh-session-pins/types'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { ClientSessionPinsModel, type SessionPinsRemote } from '../src/client/index.ts'

const sid = (id: string): SessionId => SessionId(id)

function remoteOk<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

/** A complete snapshot: the flat order is the pin set's display order. */
function snapshot(pinned: readonly string[], groupOrder: Record<string, readonly string[]> = {}): SessionPinsSnapshot {
  return {
    pinnedSessionIds: pinned.map(sid),
    groupOrder: Object.fromEntries(
      Object.entries(groupOrder).map(([key, ids]) => [key, ids.map(sid)]),
    ),
    flatOrder: pinned.map(sid),
  }
}

/** The generated `sessionPins` namespace with per-test scripted answers. */
class FakePinsRemote implements SessionPinsRemote {
  readonly calls: Array<{ readonly method: string; readonly request: unknown }> = []
  onList: () => Promise<RemoteResult<SessionPinsSnapshot>> = () => Promise.resolve(remoteOk(snapshot(['one', 'two'])))
  onReorderFlat: (
    request: { orderedIds: string[] },
  ) => Promise<RemoteResult<SessionPinsSnapshot>> = request =>
    Promise.resolve(remoteOk(snapshot(request.orderedIds)))

  list(): Promise<RemoteResult<SessionPinsSnapshot>> {
    this.calls.push({ method: 'list', request: {} })
    return this.onList()
  }

  setPinned(request: { sessionId: string; pinned: boolean }): Promise<RemoteResult<SessionPinsSnapshot>> {
    this.calls.push({ method: 'setPinned', request })
    return Promise.resolve(remoteOk(snapshot([request.sessionId])))
  }

  reorderGroup(
    request: { groupKey: string; orderedIds: string[] },
  ): Promise<RemoteResult<SessionPinsSnapshot>> {
    this.calls.push({ method: 'reorderGroup', request })
    return Promise.resolve(remoteOk(snapshot(request.orderedIds)))
  }

  reorderFlat(request: { orderedIds: string[] }): Promise<RemoteResult<SessionPinsSnapshot>> {
    this.calls.push({ method: 'reorderFlat', request })
    return this.onReorderFlat(request)
  }
}

function modelOf(remote: FakePinsRemote): ClientSessionPinsModel {
  return new ClientSessionPinsModel(remote)
}

describe('ClientSessionPinsModel', () => {
  it('starts empty and installs the owner snapshot on reload', async () => {
    const remote = new FakePinsRemote()
    const model = modelOf(remote)

    expect(model.getSnapshot()).toEqual({ pinnedSessionIds: [], groupOrder: {}, flatOrder: [] })
    await model.reload()

    expect(model.getSnapshot()).toEqual(snapshot(['one', 'two']))
    expect(model.getSnapshot().flatOrder).toEqual([sid('one'), sid('two')])
  })

  it('keeps the snapshot identity until the owner reports a different order', async () => {
    const remote = new FakePinsRemote()
    const model = modelOf(remote)
    const listener = vi.fn()
    model.subscribe(listener)
    await model.reload()
    const installed = model.getSnapshot()

    await model.reload()
    expect(model.getSnapshot()).toBe(installed)
    expect(listener).toHaveBeenCalledOnce()

    remote.onList = () => Promise.resolve(remoteOk(snapshot(['two', 'one'])))
    await model.reload()
    expect(model.getSnapshot()).not.toBe(installed)
    expect(model.getSnapshot().flatOrder).toEqual([sid('two'), sid('one')])
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('writes a complete flat order and installs the committed result', async () => {
    const remote = new FakePinsRemote()
    const model = modelOf(remote)
    await model.reload()

    await expect(model.reorderFlat([sid('two'), sid('one')])).resolves.toMatchObject({ ok: true })

    expect(remote.calls.at(-1)).toEqual({ method: 'reorderFlat', request: { orderedIds: ['two', 'one'] } })
    expect(model.getSnapshot().flatOrder).toEqual([sid('two'), sid('one')])
  })

  it('keeps the last committed order when the owner refuses a reorder', async () => {
    const remote = new FakePinsRemote()
    const model = modelOf(remote)
    await model.reload()
    const installed = model.getSnapshot()
    remote.onReorderFlat = () => Promise.resolve({
      ok: false,
      error: new RemoteError('gateway/bad-request', 'session-pins-invalid', {}),
    })

    await expect(model.reorderFlat([sid('one')])).resolves.toMatchObject({ ok: false })

    expect(model.getSnapshot()).toBe(installed)
  })

  it('never lets an older read overwrite a newer committed order', async () => {
    const remote = new FakePinsRemote()
    const model = modelOf(remote)
    const pending = Promise.withResolvers<RemoteResult<SessionPinsSnapshot>>()
    remote.onList = () => pending.promise

    const reload = model.reload()
    await model.reorderFlat([sid('two'), sid('one')])
    pending.resolve(remoteOk(snapshot(['one', 'two'])))
    await reload

    expect(model.getSnapshot().flatOrder).toEqual([sid('two'), sid('one')])
  })

  it('keeps the last committed order and logs a failed read', async () => {
    const remote = new FakePinsRemote()
    const model = modelOf(remote)
    await model.reload()
    const installed = model.getSnapshot()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    remote.onList = () => Promise.resolve({
      ok: false,
      error: new RemoteError('gateway/internal', 'wire down', {}),
    })

    await model.reload()

    expect(model.getSnapshot()).toBe(installed)
    expect(warning).toHaveBeenCalledExactlyOnceWith('pinned session reload failed:', 'wire down')
    warning.mockRestore()
  })
})
