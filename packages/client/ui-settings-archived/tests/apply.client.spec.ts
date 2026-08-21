/** Archived settings section registration: slot entry, locale label, and injected actions. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-settings-archived/client'
import { ArchivedSection } from '../src/client/ArchivedSection.tsx'

function declare(slots: SlotRegistry): void {
  slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

async function bench(): Promise<{
  ctx: Context
  slots: SlotRegistry
  locale: LocaleRuntime
  sessions: {
    open: ReturnType<typeof vi.fn>
    deleteSession: ReturnType<typeof vi.fn>
    refresh: ReturnType<typeof vi.fn>
    list: { getSnapshot(): { byId: Record<string, unknown> }; subscribe(listener: () => void): () => void }
  }
  workspaces: { unarchiveSession: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn> }
}> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const sessions = {
    open: vi.fn(),
    deleteSession: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    list: {
      getSnapshot: () => ({ byId: {} }),
      subscribe: () => () => {},
    },
  }
  const workspaces = {
    unarchiveSession: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    list: {
      getSnapshot: () => ({ items: [], archivedSessionIds: [] }),
      subscribe: () => () => {},
    },
  }
  ctx.provide('sessions', sessions as never)
  ctx.provide('workspaces', workspaces as never)
  return {
    ctx,
    slots: ctx.get('slots') as SlotRegistry,
    locale,
    sessions,
    workspaces,
  }
}

describe('ui-settings-archived apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'sessions', 'workspaces'])
  })

  it('registers the archived nav entry with order 40 and locale copy', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(ArchivedSection)
    expect(entry.options).toMatchObject({ id: 'archived', order: 40 })
    expect(resolveSlotLabel(entry.options.label)).toBe('已归档')
    b.locale.setLocale('en')
    expect(resolveSlotLabel(entry.options.label)).toBe('Archived')
  })

  it('restore unarchives, opens when the row is present, and stays put otherwise', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const injected = entry.inject as unknown as () => import('../src/client/ArchivedSection.tsx').ArchivedSectionInjected
    await expect(injected().restore('s1' as never)).resolves.toBe(false)
    expect(b.workspaces.unarchiveSession).toHaveBeenCalledWith('s1')
    expect(b.sessions.open).not.toHaveBeenCalled()

    b.sessions.list.getSnapshot = () => ({ byId: { s1: {} } })
    await expect(injected().restore('s1' as never)).resolves.toBe(true)
    expect(b.sessions.open).toHaveBeenCalledWith('s1')
  })

  it('refresh fans out to both baselines and deleteSession delegates', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = entryInjected(b)
    await injected.refresh()
    expect(b.sessions.refresh).toHaveBeenCalledOnce()
    expect(b.workspaces.refresh).toHaveBeenCalledOnce()
    await injected.deleteSession('s1' as never)
    expect(b.sessions.deleteSession).toHaveBeenCalledWith('s1')
  })
})

function entryInjected(b: Awaited<ReturnType<typeof bench>>) {
  const entry = b.slots.entries('settings.section')[0]!
  const factory = entry.inject as unknown as () => import('../src/client/ArchivedSection.tsx').ArchivedSectionInjected
  return factory()
}
