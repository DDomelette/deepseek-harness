/** Pinned sessions client registration: three workspace slots and disposal. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-pinned-sessions/client'
import { PinnedSection } from '../src/client/PinnedSection.tsx'
import { SearchPinBadge } from '../src/client/SearchPinBadge.tsx'
import { SessionPinAction } from '../src/client/SessionPinAction.tsx'

const snapshot = { pinnedSessionIds: [], groupOrder: {}, flatOrder: [] }
const ok = <T>(value: T) => ({ ok: true as const, value })

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const opened: string[] = []
  ctx.provide('sessions', { open: (id: string) => { opened.push(id) } } as never)
  ctx.provide('remote', {
    sessionPins: {
      list: async () => ok(snapshot),
      setPinned: async () => ok(snapshot),
      reorderGroup: async () => ok(snapshot),
      reorderFlat: async () => ok(snapshot),
    },
  } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, opened }
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
    expect(inject).toEqual(['slots', 'locale', 'sessions', 'remote'])
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
})
