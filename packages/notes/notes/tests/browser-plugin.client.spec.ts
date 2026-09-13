/**
 * The plugin's browser registrations, and their removal when the plugin goes.
 *
 * The tab registry is real, because "registered" means what it says a type is;
 * the slot, locale, frame, and Remote faces are recorders, because what matters
 * here is what was handed to them — one panel seat under the type's own id with
 * its store and commands — and that every registration is gone after dispose,
 * which is what makes a reload safe.
 */
import { onTestFinished, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { NOTES_ID, NOTES_KIND } from '../src/client/definition.ts'
import { apply, inject } from '../src/client/index.ts'
import { NotesButton } from '../src/client/NotesButton.tsx'
import { NotesPanel } from '../src/client/NotesPanel.tsx'
import type { NotesButtonInjected } from '../src/client/NotesButton.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { NotesStore } from '../src/client/store.ts'
import { sessions } from './fixtures.client.ts'

/** One recorded slot registration. */
interface Recorded {
  name: string
  key?: string
  locale?: string
  store?: unknown
  inject?: unknown
  component: unknown
}

/** Boot the browser half over recorder faces. */
async function boot() {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  const registered: Recorded[] = []
  const slots = {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
      const entry: Recorded = { ...options, component }
      registered.push(entry)
      return () => { registered.splice(registered.indexOf(entry), 1) }
    }),
  }
  const dictionaries = new Map<string, unknown>()
  const locale = {
    bind: () => (key: string) => key,
    register: vi.fn((ns: string, dicts: unknown) => {
      dictionaries.set(ns, dicts)
      return () => { dictionaries.delete(ns) }
    }),
  }
  const notes = {
    sessionList: vi.fn(async () => sessions()),
    sessionCreate: vi.fn(),
    materialList: vi.fn(),
  }
  const sidebarRight = { openTab: vi.fn() }
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  ctx.provide('remote', { notes } as never)
  ctx.provide('remote.notes', notes as never)
  ctx.provide('sidebarRight', sidebarRight as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  onTestFinished(async () => { await fiber.dispose() })
  await fiber.await()
  return { tabs, registered, dictionaries, fiber, notes, sidebarRight }
}

describe('notes browser half', () => {
  it('registers the tab type and its dictionaries', async () => {
    const { tabs, dictionaries } = await boot()

    expect(tabs.get(NOTES_KIND)?.id).toBe(NOTES_ID)
    expect(tabs.get(NOTES_KIND)?.priority).toBe('builtin')
    expect(tabs.get(NOTES_KIND)?.title('sidebar://notes')).toBe('tab.title')
    expect(dictionaries.get('notes')).toEqual({ zh, en })
  })

  it('registers the panel body under the type\'s id with a store and commands', async () => {
    const { registered } = await boot()

    expect(registered.map(entry => [entry.name, entry.key, entry.locale, entry.component])).toEqual([
      ['sidebar.right.pane.tab', NOTES_ID, 'notes', NotesPanel],
      ['conversation.session.header.corner', undefined, 'notes', NotesButton],
    ])
    const panel = registered[0]
    expect(panel?.store).toBeDefined()
    expect(typeof panel?.inject).toBe('function')
  })

  it('commands the panel with the store instance the seat declares', async () => {
    const { registered, notes } = await boot()
    const registration = registered[0]
    if (registration === undefined) throw new Error('missing panel registration')
    const instance = (registration.store as NotesStore).create()
    const face = (registration.inject as (session: string, actions: unknown) => { load: () => void })(
      's-1',
      instance.actions,
    )

    face.load()

    expect(notes.sessionList).toHaveBeenCalledTimes(1)
  })

  it('opens the notes tab from the header control', async () => {
    const { registered, sidebarRight } = await boot()
    const registration = registered.find(entry => entry.component === NotesButton)
    if (registration === undefined) throw new Error('missing header registration')
    const injected = (registration.inject as () => NotesButtonInjected)()

    injected.open()

    expect(sidebarRight.openTab).toHaveBeenCalledExactlyOnceWith(NOTES_KIND)
  })

  it('takes every registration back when the plugin is disposed', async () => {
    const { tabs, registered, dictionaries, fiber } = await boot()

    await fiber.dispose()

    expect(tabs.get(NOTES_KIND)).toBeUndefined()
    expect(registered).toEqual([])
    expect(dictionaries.size).toBe(0)
  })
})
