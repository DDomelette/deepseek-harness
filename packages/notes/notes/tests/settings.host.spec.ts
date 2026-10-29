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
      prompt: '你仅作翻译，不改变语句结构，直接翻译下列内容为中文：',
      autoSend: true,
    }])
    // Absence is `undefined`, never `null`: schemastery reserves a null default
    // as "no default", so the accessors are what report it as null.
    expect(resolved.workspace).toBeUndefined()
    expect(resolved.model).toBeUndefined()
  })

  it('offers a write only while a provider is mounted', async () => {
    const notes = await bench()
    expect(notes.writable()).toBe(true)

    await ctx?.fiber.dispose()
    ctx = new Context()
    await ctx.plugin(NotesSettings, entry).await()
    expect(ctx.notesSettings.writable()).toBe(false)
    await expect(ctx.notesSettings.update({ strategy: 'auto' }))
      .rejects.toThrow(/no settings provider is mounted/)
  })

  it('writes the strategy through the provider', async () => {
    const notes = await bench()

    await notes.update({ strategy: 'auto' })

    expect(notes.strategy()).toBe('auto')
    expect(ctx?.settings.get(NOTES_SETTINGS_NAMESPACE)).toMatchObject({ strategy: 'auto' })
  })

  it('sets and clears the workspace', async () => {
    const notes = await bench()

    await notes.update({ workspace: '/work/notes' })
    expect(notes.workspace()).toBe('/work/notes')

    await notes.update({ workspace: null })
    expect(notes.workspace()).toBeNull()
  })

  it('clears the workspace for an explicitly absent value too', async () => {
    const notes = await bench()
    await notes.update({ workspace: '/work/notes' })

    // The wire reports "no value" as either null or an omitted field; both mean
    // the field leaves the user layer.
    await notes.update({ workspace: undefined })

    expect(notes.workspace()).toBeNull()
  })

  it('sets and clears the model override', async () => {
    const notes = await bench()

    await notes.update({ model: { provider: 'deepseek', model: 'deepseek-flash' } })
    expect(notes.model()).toEqual({ provider: 'deepseek', model: 'deepseek-flash' })

    await notes.update({ model: null })
    expect(notes.model()).toBeNull()
  })

  it('stores a reasoning effort with the override, and drops it when one is not named', async () => {
    const notes = await bench()

    await notes.update({ model: { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'max' } })
    expect(notes.model()).toEqual({ provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'max' })

    // A route without an effort stores none, so the route's own default applies.
    await notes.update({ model: { provider: 'deepseek', model: 'deepseek-flash' } })
    expect(notes.model()).toEqual({ provider: 'deepseek', model: 'deepseek-flash' })
  })

  it('clears an explicitly absent model override too', async () => {
    const notes = await bench()
    await notes.update({ model: { provider: 'deepseek', model: 'deepseek-flash' } })

    await notes.update({ model: undefined })

    expect(notes.model()).toBeNull()
  })

  it('replaces the whole action list', async () => {
    const notes = await bench()
    const actions = [{ id: 'translate', label: '译', prompt: '翻译下面这段：', autoSend: true }]

    expect(await notes.update({ actions })).toBeNull()

    expect(notes.actions()).toEqual(actions)
  })

  it('clears the action list back to the composition entry', async () => {
    const notes = await bench()
    await notes.update({ actions: [{ id: 'translate', label: '译', prompt: '翻译：', autoSend: true }] })

    expect(await notes.update({ actions: null })).toBeNull()

    expect(notes.actions()).toEqual([])
  })

  it('refuses an action with no id, label, or prompt', async () => {
    const notes = await bench()
    const action = { id: 'translate', label: '译', prompt: '翻译：', autoSend: true }

    expect(await notes.update({ actions: [{ ...action, id: '  ' }] })).toEqual({ code: 'invalid-actions' })
    expect(await notes.update({ actions: [{ ...action, label: ' ' }] })).toEqual({ code: 'invalid-actions' })
    expect(await notes.update({ actions: [{ ...action, prompt: '\n' }] })).toEqual({ code: 'invalid-actions' })

    // Nothing was written, so the refused list never became the section.
    expect(notes.actions()).toEqual([])
  })

  it('refuses two actions sharing one id', async () => {
    const notes = await bench()
    const action = { id: 'translate', label: '译', prompt: '翻译：', autoSend: true }

    expect(await notes.update({ actions: [action, { ...action, label: '另一条' }] }))
      .toEqual({ code: 'invalid-actions' })

    expect(notes.actions()).toEqual([])
  })

  it('writes nothing for an empty patch', async () => {
    const notes = await bench()

    await notes.update({})

    expect(ctx?.settings.get(NOTES_SETTINGS_NAMESPACE)).toEqual({ strategy: 'manual', actions: [] })
  })
})
