/**
 * The notes settings section: the composition entry is the base layer, a user
 * write through the provider is what the owner then reads, and the row schema
 * defaults to the manual strategy with the built-in translate action.
 */
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { afterEach, describe, expect, it } from 'vitest'
import { Config, NOTES_SETTINGS_NAMESPACE, NotesSettings } from '../src/settings.ts'

/**
 * Minimal in-memory provider. `@deepseek-ai/dsh-settings` exports the abstract
 * `SettingsProvider`, which cannot be mounted itself, and its own `tests/`
 * directory is not part of the package's `exports`, so every consumer spec
 * declares its own.
 */
class MemorySettings extends SettingsProvider {
  private doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

const entry: Config = { strategy: 'manual', actions: [] }

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

/** Mount a provider and the notes settings owner over one context. */
async function bench(): Promise<NotesSettings> {
  ctx = new Context()
  await ctx.plugin(MemorySettings).await()
  await ctx.plugin(NotesSettings, entry).await()
  return ctx.notesSettings
}

describe('notes settings', () => {
  it('serves the composition entry as the base', async () => {
    const notes = await bench()
    expect(notes.strategy()).toBe('manual')
    expect(notes.actions()).toEqual([])
    expect(notes.workspace()).toBeNull()
    expect(notes.model()).toBeNull()
    expect(ctx?.settings.get(NOTES_SETTINGS_NAMESPACE)).toMatchObject({ strategy: 'manual' })
  })

  it('reflects a user write over the composition entry', async () => {
    const notes = await bench()
    await ctx?.settings.update(NOTES_SETTINGS_NAMESPACE, { strategy: 'auto' })
    expect(notes.strategy()).toBe('auto')
  })

  it('reflects a user write to the workspace and model overrides', async () => {
    const notes = await bench()
    await ctx?.settings.update(NOTES_SETTINGS_NAMESPACE, {
      workspace: '/work/notes',
      model: { provider: 'deepseek', model: 'deepseek-flash' },
    })
    expect(notes.workspace()).toBe('/work/notes')
    expect(notes.model()).toEqual({ provider: 'deepseek', model: 'deepseek-flash' })
  })

  it('defaults an absent composition entry to manual with the translate action', () => {
    // The Loader resolves a row's absent config through this schema, so the
    // defaults here are exactly what a bare `notes` row composes.
    const resolved = Config(undefined)
    expect(resolved.strategy).toBe('manual')
    expect(resolved.actions).toEqual([{
      id: 'translate',
      label: '翻译',
      prompt: '不改变语句结构，翻译下列内容：',
      autoSend: true,
    }])
    // Absence is `undefined`, never `null`: schemastery reserves a null default
    // as "no default", so the accessors are what report it as null.
    expect(resolved.workspace).toBeUndefined()
    expect(resolved.model).toBeUndefined()
  })
})
