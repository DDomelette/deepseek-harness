/** Pinned sessions client registration: three workspace slots and disposal. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-pinned-sessions/client'
import { createPinnedSessionsStore } from '../src/client/stores.ts'
import { PinnedSection } from '../src/client/PinnedSection.tsx'
import { SearchPinBadge } from '../src/client/SearchPinBadge.tsx'
import { SessionPinAction } from '../src/client/SessionPinAction.tsx'

const sid = (id: string) => id as import('@deepseek-ai/dsh-api-remotes/client').SessionId
const snapshot = { pinnedSessionIds: [] as readonly import('@deepseek-ai/dsh-api-remotes/client').SessionId[], groupOrder: {}, flatOrder: [] as readonly import('@deepseek-ai/dsh-api-remotes/client').SessionId[] }
const ok = <T>(value: T) => ({ ok: true as const, value })

async function bench(listSnapshot = snapshot, remoteOverrides: Record<string, unknown> = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const opened: string[] = []
  const installedFlags: unknown[] = []
  ctx.provide('sessions', {
    open: (id: string) => { opened.push(id) },
    binding: () => undefined,
    fork: async () => undefined,
  } as never)
  ctx.provide('workspaces', {
    installSessionFlags: (flags: unknown) => { installedFlags.push(flags) },
    archiveSession: async () => {},
  } as never)
  ctx.provide('remote', {
    sessionPins: {
      list: async () => ok(listSnapshot),
      setPinned: async () => ok(listSnapshot),
      reorderGroup: async () => ok(listSnapshot),
      reorderFlat: async () => ok(listSnapshot),
      ...remoteOverrides,
    },
  } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, opened, installedFlags }
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
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'sessions', 'workspaces', 'remote'])
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
    const entry = b.slots.entries('sidebar.workspaces.pinned')[0]!
    ;(entry.inject as () => {})()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(b.installedFlags).toEqual([{ s1: { pinned: true } }])
  })

  it('serializes rapid client mutations so a late response cannot overwrite a newer one', async () => {
    const order: string[] = []
    let active = 0
    let maxActive = 0
    const b = await bench(snapshot, {
      setPinned: async ({ sessionId }: { sessionId: string }) => {
        order.push(sessionId)
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise(resolve => setTimeout(resolve, 10))
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
    await Promise.all([
      face.setPinned(sid('s1'), true, previous),
      face.setPinned(sid('s2'), true, previous),
    ])
    expect(order).toEqual(['s1', 's2'])
    expect(maxActive).toBe(1)
  })
})
