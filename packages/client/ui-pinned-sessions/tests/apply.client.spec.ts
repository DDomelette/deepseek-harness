/** Pinned sessions client registration: three workspace slots and disposal. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-pinned-sessions/client'
import { createPinnedSessionsStore } from '../src/client/stores.ts'
import { PinnedSection } from '../src/client/PinnedSection.tsx'
import { SearchPinBadge } from '../src/client/SearchPinBadge.tsx'
import { SessionPinAction } from '../src/client/SessionPinAction.tsx'
import * as host from '../src/index.ts'
import type { PinnedSessionsInjected, SessionPinsSnapshot } from '../src/client/index.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'

const sid = (id: string) => id as import('@deepseek-ai/dsh-api-remotes/client').SessionId
const snapshot = { pinnedSessionIds: [] as readonly import('@deepseek-ai/dsh-api-remotes/client').SessionId[], groupOrder: {}, flatOrder: [] as readonly import('@deepseek-ai/dsh-api-remotes/client').SessionId[] }
const ok = <T>(value: T) => ({ ok: true as const, value })
const failure = { ok: false as const, error: new RemoteError('gateway/internal', 'Not available', {}) }
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function bench(listSnapshot: SessionPinsSnapshot = snapshot, remoteOverrides: Record<string, unknown> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const opened: string[] = []
  const installedFlags: unknown[] = []
  const rename = vi.fn<(title: string) => Promise<RemoteResult<undefined>>>(async () => ok(undefined))
  const sessions = {
    open: (id: string) => { opened.push(id) },
    binding: vi.fn<() => { session: { rename: typeof rename } } | undefined>(() => ({ session: { rename } })),
    fork: vi.fn(async () => sid('child')),
  }
  ctx.provide('sessions', sessions as never)
  ctx.provide('uiWorkspace', {
    registerSessionFlags: (source: { getSnapshot(): unknown; subscribe(listener: () => void): () => void }) => {
      installedFlags.push(source.getSnapshot())
      return source.subscribe(() => { installedFlags.push(source.getSnapshot()) })
    },
  } as never)
  const archiveSession = vi.fn(async () => {})
  ctx.provide('workspaces', { archiveSession } as never)
  const sessionPins = {
    list: async () => ok(listSnapshot),
    setPinned: async () => ok(listSnapshot),
    reorderGroup: async () => ok(listSnapshot),
    reorderFlat: async () => ok(listSnapshot),
    ...remoteOverrides,
  }
  ctx.provide('remote', { sessionPins } as never)
  ctx.provide('remote.sessionPins', sessionPins)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, opened, installedFlags, sessions, rename, archiveSession }
}

async function mountFace(b: Awaited<ReturnType<typeof bench>>) {
  declare(b.slots)
  await b.ctx.plugin({ inject: [...inject], apply }).await()
  const store = createPinnedSessionsStore().create()
  const entry = b.slots.entries('sidebar.workspaces.pinned')[0]!
  const factory = entry.inject as unknown as (actions: typeof store.actions) => PinnedSessionsInjected
  return { store, face: factory(store.actions) }
}

function declare(slots: SlotRegistry): void {
  slots.register({
    name: 'root',
    children: {
      'sidebar.workspaces.pinned': { kind: 'single', scope: 'root' },
      'sidebar.workspaces.sessionActions': { kind: 'list', scope: 'root' },
      'sidebar.workspaces.searchResultExtra': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-pinned-sessions apply', () => {
  it('records transport refresh failures and recovers on the next mounted load', async () => {
    const list = vi.fn<() => Promise<RemoteResult<SessionPinsSnapshot>>>()
      .mockRejectedValueOnce('Connection lost').mockResolvedValue(ok(snapshot))
    const b = await bench(snapshot, { list })
    const { store } = await mountFace(b)
    await vi.waitFor(() => { expect(store.getSnapshot().error).toBe('Connection lost') })
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(store.getSnapshot().ready).toBe(true) })
    expect(store.getSnapshot().error).toBeNull()
  })

  it('keeps loaded pin membership unique and removes unpinned ids from every order', async () => {
    const initial = {
      pinnedSessionIds: [sid('one'), sid('two')],
      groupOrder: { single: [sid('one')], shared: [sid('one'), sid('two')] },
      flatOrder: [sid('one'), sid('two')],
    }
    const pending = Promise.withResolvers<RemoteResult<SessionPinsSnapshot>>()
    const setPinned = vi.fn<() => Promise<RemoteResult<SessionPinsSnapshot>>>()
      .mockResolvedValueOnce(ok(initial)).mockReturnValueOnce(pending.promise)
    const b = await bench(initial, { setPinned })
    const { face, store } = await mountFace(b)
    await face.setPinned(sid('one'), true, initial)
    expect(store.getSnapshot().snapshot.pinnedSessionIds).toEqual(initial.pinnedSessionIds)
    const removed = face.setPinned(sid('one'), false, initial)
    await vi.waitFor(() => { expect(setPinned).toHaveBeenCalledTimes(2) })
    const expected = { pinnedSessionIds: [sid('two')], groupOrder: { shared: [sid('two')] }, flatOrder: [sid('two')] }
    expect(store.getSnapshot().snapshot).toEqual(expected)
    expect(b.installedFlags.at(-1)).toEqual({ two: { pinned: true } })
    pending.resolve(ok(expected))
    await removed
    expect(store.getSnapshot().snapshot).toEqual(expected)
  })

  it('rolls back failed pins and permits the next queued mutation', async () => {
    const setPinned = vi.fn<() => Promise<RemoteResult<SessionPinsSnapshot>>>()
      .mockResolvedValueOnce(failure).mockResolvedValueOnce(ok(snapshot))
    const b = await bench(snapshot, { setPinned })
    const { face, store } = await mountFace(b)
    await expect(face.setPinned(sid('one'), true, snapshot)).rejects.toThrow('Not available')
    expect(store.getSnapshot().snapshot).toEqual(snapshot)
    expect(b.installedFlags.at(-1)).toEqual({})
    await face.setPinned(sid('two'), true, snapshot)
    expect(setPinned).toHaveBeenCalledTimes(2)
  })

  it.each(['group', 'flat'] as const)('rolls back a failed %s reorder before committing the next one', async (kind) => {
    const initial = { ...snapshot, pinnedSessionIds: [sid('one'), sid('two')] }
    const orderedIds = [sid('two'), sid('one')]
    const next = { ...initial, groupOrder: { ws: orderedIds }, flatOrder: orderedIds }
    const reorder = vi.fn<() => Promise<RemoteResult<SessionPinsSnapshot>>>()
      .mockResolvedValueOnce(failure).mockResolvedValueOnce(ok(next))
    const b = await bench(initial, { [kind === 'group' ? 'reorderGroup' : 'reorderFlat']: reorder })
    const { face, store } = await mountFace(b)
    const run = () => kind === 'group'
      ? face.reorderGroup('ws', orderedIds, initial)
      : face.reorderFlat(orderedIds, initial)
    await expect(run()).rejects.toThrow('Not available')
    expect(store.getSnapshot().snapshot).toEqual(initial)
    await run()
    expect(store.getSnapshot().snapshot).toEqual(next)
    expect(reorder).toHaveBeenLastCalledWith(kind === 'group' ? { groupKey: 'ws', orderedIds } : { orderedIds })
  })

  it('opens, renames, forks, and archives through the owning session services', async () => {
    const b = await bench()
    const { face } = await mountFace(b)
    face.open(sid('one'))
    expect(b.opened).toEqual(['one'])
    await face.renameSession(sid('one'), 'Renamed')
    expect(b.rename).toHaveBeenCalledWith('Renamed')
    b.sessions.binding.mockReturnValueOnce(undefined)
    await expect(face.renameSession(sid('missing'), 'Missing')).rejects.toThrow('unknown session')
    b.rename.mockResolvedValueOnce(failure)
    await expect(face.renameSession(sid('one'), 'Rejected')).rejects.toThrow('Not available')
    face.forkSession(sid('one'))
    await vi.waitFor(() => { expect(b.opened).toEqual(['one', 'child']) })
    expect(b.sessions.fork).toHaveBeenCalledWith({ sessionId: sid('one'), increaseTitle: true })
    b.sessions.fork.mockRejectedValueOnce(new Error('Cannot fork'))
    face.forkSession(sid('one'))
    await expect(b.sessions.fork.mock.results[1]!.value).rejects.toThrow('Cannot fork')
    await face.archiveSession(sid('one'))
    expect(b.archiveSession).toHaveBeenCalledWith(sid('one'))
    expect(b.opened).toEqual(['one', 'child'])
  })

  it('retains the last snapshot and publishes a failed refresh until recovery', async () => {
    let fail = false
    const initial = { ...snapshot, pinnedSessionIds: [sid('one')] }
    const b = await bench(initial, { list: async () => fail ? failure : ok(initial) })
    const { store } = await mountFace(b)
    await vi.waitFor(() => { expect(store.getSnapshot().ready).toBe(true) })
    fail = true
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(store.getSnapshot().error).toContain('Not available') })
    expect(store.getSnapshot().snapshot).toEqual(initial)
    fail = false
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(store.getSnapshot().error).toBeNull() })
  })

  it('loads its host entry as a function plugin', async () => {
    const ctx = new Context()
    try {
      expect('default' in host).toBe(false)
      await ctx.plugin(host).await()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace', 'remote', 'remote.sessionPins'])
  })

  it('registers the three workspace slots and disposes them with the fiber', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await Promise.resolve()
    expect(b.slots.entries('sidebar.workspaces.pinned')[0]!.component).toBe(PinnedSection)
    expect(b.slots.entries('sidebar.workspaces.sessionActions')[0]!.component).toBe(SessionPinAction)
    expect(b.slots.entries('sidebar.workspaces.searchResultExtra')[0]!.component).toBe(SearchPinBadge)
    await fiber.dispose()
    expect(b.slots.entries('sidebar.workspaces.pinned')).toHaveLength(0)
    expect(b.slots.entries('sidebar.workspaces.sessionActions')).toHaveLength(0)
    expect(b.slots.entries('sidebar.workspaces.searchResultExtra')).toHaveLength(0)
  })

  it('publishes remote pin membership into the workspace sessionFlags mirror', async () => {
    const pinned = { pinnedSessionIds: [sid('s1')], groupOrder: {}, flatOrder: [] }
    const b = await bench(pinned)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(b.installedFlags).toEqual([{}, { s1: { pinned: true } }]) })
  })

  it('serializes rapid client mutations so a late response cannot overwrite a newer one', async () => {
    const order: string[] = []
    let active = 0
    let maxActive = 0
    const first = Promise.withResolvers<undefined>()
    const b = await bench(snapshot, {
      setPinned: async ({ sessionId }: { sessionId: string }) => {
        order.push(sessionId)
        active += 1
        maxActive = Math.max(maxActive, active)
        if (sessionId === 's1') await first.promise
        active -= 1
        return ok({ pinnedSessionIds: [sid(sessionId)], groupOrder: {}, flatOrder: [] })
      },
    })
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('sidebar.workspaces.pinned')[0]!
    const injected = entry.inject as unknown as (actions: ReturnType<ReturnType<typeof createPinnedSessionsStore>['create']>['actions']) =>
    import('../src/client/index.ts').PinnedSessionsInjected
    const face = injected(createPinnedSessionsStore().create().actions)
    const previous = snapshot
    const pending = Promise.all([
      face.setPinned(sid('s1'), true, previous),
      face.setPinned(sid('s2'), true, previous),
    ])
    await vi.waitFor(() => { expect(order).toEqual(['s1']) })
    first.resolve(undefined)
    await pending
    expect(order).toEqual(['s1', 's2'])
    expect(maxActive).toBe(1)
  })
})
