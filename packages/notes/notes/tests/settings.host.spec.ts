/**
 * The notes settings section: the composition entry is the base layer, a write
 * through the settings seam is what the owner then reads, and the row schema
 * defaults to the manual strategy with the built-in translate action.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { configurationFixture } from '../../../settings/settings/tests/configuration-fixture.ts'
import { Config, NOTES_SETTINGS_NAMESPACE, NotesSettings } from '../src/settings.ts'
import type { Config as NotesConfig } from '../src/settings.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

/**
 * Mount the notes settings owner as a real Loader entry under a profile whose
 * patch the settings service writes; the entry id is the settings namespace.
 * A committed write restarts the entry, so every assertion reads the live
 * service again.
 */
async function bench() {
  const home = await configurationFixture({
    schema: Config as never,
    apply: (host, config) => { host.plugin(NotesSettings, config as NotesConfig) },
    probeId: NOTES_SETTINGS_NAMESPACE,
    probeConfig: { strategy: 'manual', actions: [] },
    hmr: false,
  })
  ctx = home.ctx
  return { notes: (): NotesSettings => ctx!.notesSettings }
}

describe('notes settings', () => {
  it('serves the composition entry as the base', async () => {
    const { notes } = await bench()
    expect(notes().strategy()).toBe('manual')
    expect(notes().actions()).toEqual([])
    expect(notes().workspace()).toBeNull()
    expect(notes().model()).toBeNull()
  })

  it('defaults an absent composition entry to manual with the translate action', () => {
    // The Loader resolves a row's absent config through this schema, so the
    // defaults here are exactly what a bare `notes` row composes.
    const resolved = Config(undefined)
    expect(resolved.strategy.get()).toBe('manual')
    expect(resolved.actions.get()).toEqual([{
      id: 'translate',
      label: '翻译',
      prompt: '你仅作翻译，不改变语句结构，直接翻译下列内容为中文：',
      autoSend: true,
    }])
    // Absence is `undefined`, never `null`: schemastery reserves a null default
    // as "no default", so the accessors are what report it as null.
    expect(resolved.workspace.get()).toBeUndefined()
    expect(resolved.model.get()).toBeUndefined()
  })

  it('offers a write only while a settings service is mounted', async () => {
    const { notes } = await bench()
    expect(notes().writable()).toBe(true)

    await ctx!.fiber.dispose()
    ctx = new Context()
    await ctx.plugin(NotesSettings, Config({ strategy: 'manual', actions: [] })).await()
    expect(ctx.notesSettings.writable()).toBe(false)
    await expect(ctx.notesSettings.update({ strategy: 'auto' }))
      .rejects.toThrow(/no settings provider is mounted/)
  })

  it('writes the strategy through the profile patch', async () => {
    const { notes } = await bench()

    await notes().update({ strategy: 'auto' })

    expect(notes().strategy()).toBe('auto')
    expect(ctx!.settings.describe().find(row => row.ns === NOTES_SETTINGS_NAMESPACE)?.value)
      .toMatchObject({ strategy: 'auto' })
  })

  it('sets and clears the workspace', async () => {
    const { notes } = await bench()

    await notes().update({ workspace: '/work/notes' })
    expect(notes().workspace()).toBe('/work/notes')

    await notes().update({ workspace: null })
    expect(notes().workspace()).toBeNull()
  })

  it('clears the workspace for an explicitly absent value too', async () => {
    const { notes } = await bench()
    await notes().update({ workspace: '/work/notes' })

    // The wire reports "no value" as either null or an omitted field; both mean
    // the field leaves the user layer.
    await notes().update({ workspace: undefined })

    expect(notes().workspace()).toBeNull()
  })

  it('sets and clears the model override', async () => {
    const { notes } = await bench()

    await notes().update({ model: { provider: 'deepseek', model: 'deepseek-flash' } })
    expect(notes().model()).toEqual({ provider: 'deepseek', model: 'deepseek-flash' })

    await notes().update({ model: null })
    expect(notes().model()).toBeNull()
  })

  it('stores a reasoning effort with the override, and drops it when one is not named', async () => {
    const { notes } = await bench()

    await notes().update({ model: { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'max' } })
    expect(notes().model()).toEqual({ provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'max' })

    // A route without an effort stores none, so the route's own default applies.
    await notes().update({ model: { provider: 'deepseek', model: 'deepseek-flash' } })
    expect(notes().model()).toEqual({ provider: 'deepseek', model: 'deepseek-flash' })
  })

  it('clears an explicitly absent model override too', async () => {
    const { notes } = await bench()
    await notes().update({ model: { provider: 'deepseek', model: 'deepseek-flash' } })

    await notes().update({ model: undefined })

    expect(notes().model()).toBeNull()
  })

  it('replaces the whole action list', async () => {
    const { notes } = await bench()
    const actions = [{ id: 'translate', label: '译', prompt: '翻译下面这段：', autoSend: true }]

    expect(await notes().update({ actions })).toBeNull()

    expect(notes().actions()).toEqual(actions)
  })

  it('clears the action list back to the composition entry', async () => {
    const { notes } = await bench()
    await notes().update({ actions: [{ id: 'translate', label: '译', prompt: '翻译：', autoSend: true }] })

    expect(await notes().update({ actions: null })).toBeNull()

    expect(notes().actions()).toEqual([])
  })

  it('refuses an action with no id, label, or prompt', async () => {
    const { notes } = await bench()
    const action = { id: 'translate', label: '译', prompt: '翻译：', autoSend: true }

    expect(await notes().update({ actions: [{ ...action, id: '  ' }] })).toEqual({ code: 'invalid-actions' })
    expect(await notes().update({ actions: [{ ...action, label: ' ' }] })).toEqual({ code: 'invalid-actions' })
    expect(await notes().update({ actions: [{ ...action, prompt: '\n' }] })).toEqual({ code: 'invalid-actions' })

    // Nothing was written, so the refused list never became the section.
    expect(notes().actions()).toEqual([])
  })

  it('refuses two actions sharing one id', async () => {
    const { notes } = await bench()
    const action = { id: 'translate', label: '译', prompt: '翻译：', autoSend: true }

    expect(await notes().update({ actions: [action, { ...action, label: '另一条' }] }))
      .toEqual({ code: 'invalid-actions' })

    expect(notes().actions()).toEqual([])
  })

  it('writes nothing for an empty patch', async () => {
    const { notes } = await bench()

    expect(await notes().update({})).toBeNull()

    expect(notes().strategy()).toBe('manual')
    expect(notes().actions()).toEqual([])
  })
})
