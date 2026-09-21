// @vitest-environment jsdom
/**
 * The settings card: what one deployment's notes section resolves to, the
 * fields a reader can change from it — the directory with its chooser and
 * browser, the model route with its reasoning effort, and the selection
 * features — and the commands behind them.
 *
 * The card is rendered directly over one bench's stored state, so a case that
 * needs the panel's subscription to the store lives in the panel spec instead.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NotesSettingsCard } from '../src/client/NotesSettingsCard.tsx'
import type { NotesActionView } from '../src/types.ts'
import {
  directoryListing, harness, modelCatalog, settings, unavailable,
} from './fixtures.client.ts'

afterEach(cleanup)

/** The selection feature the default fixture section carries. */
const TRANSLATE: NotesActionView = {
  id: 'translate',
  label: '翻译',
  prompt: '不改变语句结构，翻译下列内容：',
  autoSend: true,
}

/** Render the card over one bench's stored section. */
function show(bench: ReturnType<typeof harness>, close = vi.fn()): void {
  const props = bench.props()
  const state = bench.instance.getSnapshot()
  render(
    <NotesSettingsCard
      settings={state.settings}
      loading={state.settingsLoading}
      failure={state.settingsFailure}
      commands={props}
      t={props.t}
      close={close}
    />,
  )
}

/** Read the section into one bench, then render the card over it. */
async function opened(bench: ReturnType<typeof harness>, close = vi.fn()): Promise<void> {
  bench.face.readSettings()
  await waitFor(() => { expect(bench.instance.getSnapshot().settingsLoading).toBe(false) })
  show(bench, close)
}

/** Every browse row's path, in render order. */
function entryPaths(): string[] {
  return [...document.querySelectorAll('[data-notes-browse-entry]')]
    .map(row => row.getAttribute('data-notes-browse-entry') ?? '')
}

/** The browse row one path names. */
function entry(path: string): Element {
  const row = [...document.querySelectorAll('[data-notes-browse-entry]')]
    .find(candidate => candidate.getAttribute('data-notes-browse-entry') === path)
  if (row === undefined) throw new Error(`no browse row for ${path}`)
  return row
}

/** The catalog the card reads for its model picker, once that read answered. */
async function modelsRead(bench: ReturnType<typeof harness>): Promise<void> {
  await waitFor(() => { expect(bench.session.modelCatalog).toHaveBeenCalledTimes(1) })
}

describe('notes settings card', () => {
  it('shows the strategy, the workspace, the model route, and the selection feature', async () => {
    const bench = harness()
    await opened(bench)
    await modelsRead(bench)

    expect(document.querySelector('[data-notes-strategy="manual"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('[data-notes-strategy="auto"]')?.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByLabelText<HTMLInputElement>('settings.workspace').value).toBe('/work/notes')
    // The deployment serves no override here, so the picker shows the default.
    expect(screen.getByLabelText<HTMLSelectElement>('settings.modelPick').value).toBe('')
    // A feature's name and prompt are what the reader edits.
    expect(screen.getByLabelText<HTMLSelectElement>('settings.actionPick').value).toBe('translate')
    expect(screen.getByLabelText<HTMLInputElement>('settings.actionLabelInput').value).toBe('翻译')
    expect(screen.getByLabelText<HTMLTextAreaElement>('settings.actionPromptInput').value)
      .toBe('不改变语句结构，翻译下列内容：')
    expect(screen.getByText('settings.autoSend')).toBeDefined()
  })

  it('leaves the workspace field empty while none is configured', async () => {
    const bench = harness({ settings: () => settings({ workspace: null }) })
    await opened(bench)

    expect(screen.getByLabelText<HTMLInputElement>('settings.workspace').value).toBe('')
  })

  it('names a feature that only adds', async () => {
    const bench = harness({
      settings: () => settings({
        actions: [{ id: 'clip', label: '剪藏', prompt: '保存：', autoSend: false }],
      }),
    })
    await opened(bench)

    expect(screen.getByText('settings.manualSend')).toBeDefined()
    expect(screen.queryByText('settings.autoSend')).toBeNull()
  })

  it('offers the prompt placeholder the reader types into', async () => {
    const bench = harness()
    await opened(bench)

    expect(screen.getByLabelText('settings.actionPromptInput').getAttribute('placeholder'))
      .toBe('settings.actionPromptPlaceholder')
  })

  it('saves a strategy change', async () => {
    const bench = harness()
    const save = vi.spyOn(bench.props(), 'saveSettings')
    await opened(bench)

    fireEvent.click(document.querySelector('[data-notes-strategy="auto"]')!)

    expect(save).toHaveBeenCalledExactlyOnceWith({ strategy: 'auto' })
  })

  it('edits one feature\'s name and prompt, and keeps the others as stored', async () => {
    const clip: NotesActionView = { id: 'clip', label: '剪藏', prompt: '保存：', autoSend: false }
    const bench = harness({ settings: () => settings({ actions: [TRANSLATE, clip] }) })
    const save = vi.spyOn(bench.props(), 'saveSettings')
    await opened(bench)

    fireEvent.change(screen.getByLabelText('settings.actionLabelInput'), { target: { value: '译' } })
    fireEvent.change(screen.getByLabelText('settings.actionPromptInput'), { target: { value: '翻译下面这段：' } })
    fireEvent.click(document.querySelector('[data-notes-save-action]') as Element)

    expect(save).toHaveBeenCalledExactlyOnceWith({
      actions: [{ ...TRANSLATE, label: '译', prompt: '翻译下面这段：' }, clip],
    })
  })

  it('keeps a feature\'s save disabled until its copy changes', async () => {
    const bench = harness()
    await opened(bench)

    expect(document.querySelector('[data-notes-save-action]')?.hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByLabelText('settings.actionLabelInput'), { target: { value: '译' } })

    expect(document.querySelector('[data-notes-save-action]')?.hasAttribute('disabled')).toBe(false)
  })

  it('keeps a feature\'s save disabled while a field is blank', async () => {
    const bench = harness()
    await opened(bench)

    fireEvent.change(screen.getByLabelText('settings.actionPromptInput'), { target: { value: '   ' } })

    expect(document.querySelector('[data-notes-save-action]')?.hasAttribute('disabled')).toBe(true)
  })

  it('adds a feature the reader names and prompts, with an id the list does not use', async () => {
    const bench = harness({ settings: () => settings({ actions: [TRANSLATE] }) })
    const save = vi.spyOn(bench.props(), 'saveSettings')
    await opened(bench)

    fireEvent.click(document.querySelector('[data-notes-add-action]') as Element)

    // The editor starts empty, ready for a feature that does not exist yet.
    expect(screen.getByLabelText<HTMLInputElement>('settings.actionLabelInput').value).toBe('')
    expect(screen.getByLabelText<HTMLTextAreaElement>('settings.actionPromptInput').value).toBe('')

    fireEvent.change(screen.getByLabelText('settings.actionLabelInput'), { target: { value: '总结' } })
    fireEvent.change(screen.getByLabelText('settings.actionPromptInput'), { target: { value: '总结下列内容：' } })
    fireEvent.click(document.querySelector('[data-notes-save-action]') as Element)

    expect(save).toHaveBeenCalledExactlyOnceWith({
      actions: [TRANSLATE, { id: 'custom-1', label: '总结', prompt: '总结下列内容：', autoSend: false }],
    })
  })

  it('takes the next free id when the list already carries one', async () => {
    const bench = harness({
      settings: () => settings({
        actions: [TRANSLATE, { id: 'custom-1', label: '旧', prompt: '旧：', autoSend: false }],
      }),
    })
    const save = vi.spyOn(bench.props(), 'saveSettings')
    await opened(bench)

    fireEvent.click(document.querySelector('[data-notes-add-action]') as Element)
    fireEvent.change(screen.getByLabelText('settings.actionLabelInput'), { target: { value: '总结' } })
    fireEvent.change(screen.getByLabelText('settings.actionPromptInput'), { target: { value: '总结下列内容：' } })
    fireEvent.click(document.querySelector('[data-notes-save-action]') as Element)

    expect(save.mock.calls[0]?.[0].actions?.map(action => action.id))
      .toEqual(['translate', 'custom-1', 'custom-2'])
  })

  it('starts an empty editor while the section carries no feature at all', async () => {
    const bench = harness({ settings: () => settings({ actions: [] }) })
    await opened(bench)

    // Nothing is configured, so the picker offers only the feature being added.
    expect([...screen.getByLabelText<HTMLSelectElement>('settings.actionPick').options]
      .map(option => option.textContent)).toEqual(['settings.actionNew'])
    expect(screen.getByLabelText<HTMLInputElement>('settings.actionLabelInput').value).toBe('')
    expect(screen.getByLabelText<HTMLTextAreaElement>('settings.actionPromptInput').value).toBe('')
  })

  it('returns to the empty editor when the reader picks the new-feature entry again', async () => {
    const bench = harness()
    await opened(bench)

    fireEvent.click(document.querySelector('[data-notes-add-action]') as Element)
    fireEvent.change(screen.getByLabelText('settings.actionLabelInput'), { target: { value: '总结' } })
    fireEvent.change(screen.getByLabelText('settings.actionPromptInput'), { target: { value: '总结：' } })

    fireEvent.change(screen.getByLabelText('settings.actionPick'), { target: { value: '' } })

    expect(screen.getByLabelText<HTMLInputElement>('settings.actionLabelInput').value).toBe('')
    expect(screen.getByLabelText<HTMLTextAreaElement>('settings.actionPromptInput').value).toBe('')
  })

  it('shows the features the section carries in the picker', async () => {
    const bench = harness({
      settings: () => settings({
        actions: [TRANSLATE, { id: 'clip', label: '剪藏', prompt: '保存：', autoSend: false }],
      }),
    })
    await opened(bench)

    const picker = screen.getByLabelText<HTMLSelectElement>('settings.actionPick')
    expect([...picker.options].map(option => option.textContent)).toEqual(['翻译', '剪藏'])

    fireEvent.change(picker, { target: { value: 'clip' } })

    expect(screen.getByLabelText<HTMLInputElement>('settings.actionLabelInput').value).toBe('剪藏')
    expect(screen.getByLabelText<HTMLTextAreaElement>('settings.actionPromptInput').value).toBe('保存：')
  })

  it('saves the workspace when the field commits, and clears it when emptied', async () => {
    const bench = harness()
    const save = vi.spyOn(bench.props(), 'saveSettings')
    await opened(bench)

    const field = screen.getByLabelText('settings.workspace')
    fireEvent.change(field, { target: { value: '/work/other' } })
    fireEvent.blur(field)
    expect(save).toHaveBeenCalledExactlyOnceWith({ workspace: '/work/other' })

    fireEvent.change(field, { target: { value: '' } })
    fireEvent.blur(field)
    expect(save).toHaveBeenLastCalledWith({ workspace: null })
  })

  it('trims the workspace and commits on Enter, writing nothing while unchanged', async () => {
    const bench = harness()
    const save = vi.spyOn(bench.props(), 'saveSettings')
    await opened(bench)

    const field = screen.getByLabelText('settings.workspace')
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(save).not.toHaveBeenCalled()

    fireEvent.change(field, { target: { value: '  /work/other  ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(save).toHaveBeenCalledExactlyOnceWith({ workspace: '/work/other' })
  })

  it('writes only Enter, and commits against a section with no stored directory', async () => {
    const bench = harness({ settings: () => settings({ workspace: null }) })
    const save = vi.spyOn(bench.props(), 'saveSettings')
    await opened(bench)

    const field = screen.getByLabelText('settings.workspace')
    fireEvent.keyDown(field, { key: 'a' })
    expect(save).not.toHaveBeenCalled()

    fireEvent.change(field, { target: { value: '/work/fresh' } })
    fireEvent.blur(field)
    expect(save).toHaveBeenCalledExactlyOnceWith({ workspace: '/work/fresh' })
  })

  it('offers the deployment\'s configured models, grouped by provider', async () => {
    const bench = harness()
    await opened(bench)
    await modelsRead(bench)

    const picker = screen.getByLabelText<HTMLSelectElement>('settings.modelPick')
    expect([...picker.options].map(option => option.textContent))
      .toEqual(['settings.modelFollow', 'DeepSeek-Flash', 'DeepSeek-Pro'])
    expect(picker.querySelector('optgroup')?.getAttribute('label')).toBe('DeepSeek')
  })

  it('saves the picked route, and the effort the model declares', async () => {
    const bench = harness()
    const save = vi.spyOn(bench.props(), 'saveSettings')
    await opened(bench)
    await modelsRead(bench)

    // A pick is a decision, so it writes without another control.
    fireEvent.change(screen.getByLabelText('settings.modelPick'), { target: { value: 'deepseek-official/deepseek-flash' } })
    expect(save).toHaveBeenLastCalledWith({
      model: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: null },
    })
    // Only a model that declares efforts offers the second picker.
    const effort = screen.getByLabelText<HTMLSelectElement>('settings.effort')
    expect([...effort.options].map(option => option.textContent))
      .toEqual(['settings.effortDefault', 'High', 'Max'])
    fireEvent.change(effort, { target: { value: 'max' } })

    expect(save).toHaveBeenLastCalledWith({
      model: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' },
    })
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('offers no effort picker for a model that declares none', async () => {
    const bench = harness()
    await opened(bench)
    await modelsRead(bench)

    fireEvent.change(screen.getByLabelText('settings.modelPick'), { target: { value: 'deepseek-official/deepseek-pro' } })

    expect(document.querySelector('[data-notes-effort-pick]')).toBeNull()
  })

  it('shows a stored route and effort, and saves them back', async () => {
    const bench = harness({
      settings: () => settings({
        model: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' },
      }),
    })
    const save = vi.spyOn(bench.props(), 'saveSettings')
    await opened(bench)
    await modelsRead(bench)

    expect(screen.getByLabelText<HTMLSelectElement>('settings.modelPick').value)
      .toBe('deepseek-official/deepseek-flash')
    expect(screen.getByLabelText<HTMLSelectElement>('settings.effort').value).toBe('high')

    fireEvent.change(screen.getByLabelText('settings.effort'), { target: { value: '' } })

    expect(save).toHaveBeenCalledExactlyOnceWith({
      model: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: null },
    })
  })

  it('clears the override when the reader picks the session default', async () => {
    const bench = harness({
      settings: () => settings({ model: { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: null } }),
    })
    const save = vi.spyOn(bench.props(), 'saveSettings')
    await opened(bench)
    await modelsRead(bench)

    fireEvent.change(screen.getByLabelText('settings.modelPick'), { target: { value: '' } })

    expect(save).toHaveBeenCalledExactlyOnceWith({ model: null })
  })

  it('keeps a stored route the catalog no longer advertises', async () => {
    const bench = harness({
      settings: () => settings({ model: { provider: 'retired', model: 'legacy', reasoningEffort: null } }),
      catalog: () => modelCatalog(),
    })
    await opened(bench)
    await modelsRead(bench)

    const picker = screen.getByLabelText<HTMLSelectElement>('settings.modelPick')
    expect(picker.value).toBe('retired/legacy')
    expect([...picker.options].map(option => option.value)).toContain('retired/legacy')
  })

  it('keeps the stored route when the catalog cannot be read', async () => {
    const bench = harness({
      settings: () => settings({ model: { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: null } }),
      catalog: () => ({ ok: false, error: unavailable('socket closed') }),
    })
    await opened(bench)
    await modelsRead(bench)

    // The picker still names what the section stores, and the failure is the
    // one the face reported rather than a card that failed to render.
    expect([...screen.getByLabelText<HTMLSelectElement>('settings.modelPick').options]
      .map(option => option.value)).toEqual(['', 'deepseek/deepseek-flash'])
  })

  it('fills the directory field from the host\'s chooser', async () => {
    const bench = harness()
    const save = vi.spyOn(bench.props(), 'saveSettings')
    await opened(bench)

    fireEvent.click(screen.getByLabelText('settings.browse'))

    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('settings.workspace').value).toBe('/work/chosen')
    })
    expect(bench.directoryPicker.pick).toHaveBeenCalledTimes(1)
    // A picked directory is a deliberate value, so it saves on the pick.
    expect(save).toHaveBeenCalledExactlyOnceWith({ workspace: '/work/chosen' })
  })

  it('keeps what the reader typed when the chooser is cancelled', async () => {
    const bench = harness()
    bench.directoryPicker.pick.mockResolvedValueOnce({ ok: true, value: null })
    await opened(bench)

    fireEvent.change(screen.getByLabelText('settings.workspace'), { target: { value: '/work/mine' } })
    fireEvent.click(screen.getByLabelText('settings.browse'))
    await waitFor(() => { expect(bench.directoryPicker.pick).toHaveBeenCalledTimes(1) })

    expect(screen.getByLabelText<HTMLInputElement>('settings.workspace').value).toBe('/work/mine')
  })

  it('browses the host when the deployment serves no native chooser', async () => {
    const bench = harness()
    bench.directoryPicker.pick.mockResolvedValueOnce({ ok: false, error: unavailable('no chooser') })
    await opened(bench)

    fireEvent.click(screen.getByLabelText('settings.browse'))

    await waitFor(() => { expect(document.querySelector('[data-notes-browser]')).not.toBeNull() })
    // The host home, and one level of it: hidden entries stay out of the list,
    // and a level with no parent above it goes on to the volumes instead.
    expect(screen.getByText('/work')).toBeDefined()
    expect(document.querySelector('[data-notes-browse-entry="/work/notes"]')).not.toBeNull()
    expect(document.querySelector('[data-notes-browse-entry="/work/.hidden"]')).toBeNull()
    expect(document.querySelector('[data-notes-browse-up]')).toBeNull()
    expect(document.querySelector('[data-notes-browse-drives]')).toBeNull()
  })

  it('descends, goes back up, and takes the level it stands in', async () => {
    const bench = harness()
    const save = vi.spyOn(bench.props(), 'saveSettings')
    bench.directoryPicker.pick.mockResolvedValue({ ok: false, error: unavailable('no chooser') })
    bench.directoryPicker.list.mockImplementation(async path => ({
      ok: true,
      value: directoryListing(path === '/work/notes'
        ? {
          path: '/work/notes',
          crumbs: [
            { name: '/', path: '/', hidden: false },
            { name: 'work', path: '/work', hidden: false },
            { name: 'notes', path: '/work/notes', hidden: false },
          ],
          entries: [],
        }
        : {}),
    }))
    await opened(bench)

    fireEvent.click(screen.getByLabelText('settings.browse'))
    await waitFor(() => { expect(document.querySelector('[data-notes-browse-entry="/work/notes"]')).not.toBeNull() })

    fireEvent.click(document.querySelector('[data-notes-browse-entry="/work/notes"]') as Element)
    await waitFor(() => { expect(screen.getByText('/work/notes')).toBeDefined() })

    fireEvent.click(document.querySelector('[data-notes-browse-up]') as Element)
    await waitFor(() => { expect(screen.getByText('/work')).toBeDefined() })

    fireEvent.click(document.querySelector('[data-notes-browse-choose]') as Element)

    // Taking a level fills the field, saves it, and closes the browser.
    expect(screen.getByLabelText<HTMLInputElement>('settings.workspace').value).toBe('/work')
    expect(save).toHaveBeenCalledWith({ workspace: '/work' })
    expect(document.querySelector('[data-notes-browser]')).toBeNull()
  })

  it('reaches the other volumes from a drive root', async () => {
    const bench = harness()
    bench.directoryPicker.pick.mockResolvedValue({ ok: false, error: unavailable('no chooser') })
    bench.directoryPicker.list.mockImplementation(async path => ({
      ok: true,
      value: directoryListing(path === 'D:\\'
        ? { path: 'D:\\', crumbs: [{ name: 'D:\\', path: 'D:\\', hidden: false }], entries: [] }
        : path === undefined
          ? {
            path: 'C:\\',
            crumbs: [{ name: 'C:\\', path: 'C:\\', hidden: false }],
            entries: [],
            drives: [
              { name: 'C:\\', path: 'C:\\', hidden: false },
              { name: 'D:\\', path: 'D:\\', hidden: false },
            ],
          }
          : {}),
    }))
    await opened(bench)

    fireEvent.click(screen.getByLabelText('settings.browse'))
    await waitFor(() => { expect(document.querySelector('[data-notes-browse-drives]')).not.toBeNull() })

    // The drive root has no parent, so its own control opens the volumes.
    fireEvent.click(document.querySelector('[data-notes-browse-drives]') as Element)
    await waitFor(() => { expect(screen.getByText('settings.browseDrives')).toBeDefined() })
    expect(entryPaths()).toEqual(['C:\\', 'D:\\'])
    expect(document.querySelector('[data-notes-browse-choose]')).toBeNull()

    fireEvent.click(entry('D:\\'))
    await waitFor(() => { expect(screen.getByText('D:\\')).toBeDefined() })

    fireEvent.click(document.querySelector('[data-notes-browse-choose]') as Element)

    expect(screen.getByLabelText<HTMLInputElement>('settings.workspace').value).toBe('D:\\')
  })

  it('leaves the field alone when the browser is cancelled', async () => {
    const bench = harness()
    bench.directoryPicker.pick.mockResolvedValueOnce({ ok: false, error: unavailable('no chooser') })
    await opened(bench)

    fireEvent.click(screen.getByLabelText('settings.browse'))
    await waitFor(() => { expect(document.querySelector('[data-notes-browser]')).not.toBeNull() })

    fireEvent.click(document.querySelector('[data-notes-browse-close]') as Element)

    expect(document.querySelector('[data-notes-browser]')).toBeNull()
    expect(screen.getByLabelText<HTMLInputElement>('settings.workspace').value).toBe('/work/notes')
  })

  it('says so while the section is being read', () => {
    const bench = harness()
    bench.face.readSettings()
    show(bench)

    expect(screen.getByText('settings.loading')).toBeDefined()
  })

  it('reports a deployment with no writable settings provider', async () => {
    const bench = harness({
      settings: () => ({ ok: true, value: { ok: false, error: { code: 'settings-unavailable' } } }),
    })
    await opened(bench)

    expect(document.querySelector('[data-notes-settings-failure="settings-unavailable"]')).not.toBeNull()
    expect(screen.getByText('error.settingsUnavailable')).toBeDefined()
  })

  it('closes the card', async () => {
    const bench = harness()
    const close = vi.fn()
    await opened(bench, close)

    fireEvent.click(document.querySelector('[aria-label="settings.close"]')!)

    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('notes settings commands', () => {
  it('reads once, and again only when a write lands', async () => {
    const bench = harness()

    bench.face.readSettings()
    await waitFor(() => { expect(bench.remote.settingsRead).toHaveBeenCalledTimes(1) })
    bench.face.readSettings()
    await Promise.resolve()

    expect(bench.remote.settingsRead).toHaveBeenCalledTimes(1)
  })

  it('re-reads the section after a write lands', async () => {
    const bench = harness()
    bench.face.readSettings()
    await waitFor(() => { expect(bench.remote.settingsRead).toHaveBeenCalledTimes(1) })

    bench.face.saveSettings({ strategy: 'auto' })

    await waitFor(() => { expect(bench.remote.settingsRead).toHaveBeenCalledTimes(2) })
    expect(bench.remote.settingsUpdate).toHaveBeenCalledExactlyOnceWith({ strategy: 'auto' })
  })

  it('reports a carrier failure while writing', async () => {
    const bench = harness()
    bench.remote.settingsUpdate.mockResolvedValueOnce({ ok: false, error: unavailable('socket closed') })

    bench.face.saveSettings({ strategy: 'auto' })

    await waitFor(() => { expect(bench.instance.getSnapshot().settingsFailure?.code).toBe('remote-unavailable') })
  })

  it('reports the Host\'s refusal while writing', async () => {
    const bench = harness()
    bench.remote.settingsUpdate.mockResolvedValueOnce({
      ok: true,
      value: { ok: false, error: { code: 'settings-unavailable' } },
    })

    bench.face.saveSettings({ strategy: 'auto' })

    await waitFor(() => {
      expect(bench.instance.getSnapshot().settingsFailure).toEqual({ code: 'settings-unavailable' })
    })
  })

  it('reports a carrier failure while reading', async () => {
    const bench = harness({ settings: () => ({ ok: false, error: unavailable('socket closed') }) })

    bench.face.readSettings()

    await waitFor(() => { expect(bench.instance.getSnapshot().settingsFailure?.code).toBe('remote-unavailable') })
  })
})

describe('notes model catalog commands', () => {
  it('reads the deployment\'s catalog once per panel', async () => {
    const bench = harness()

    await expect(bench.face.loadModels()).resolves.toMatchObject({ groups: [{ id: 'deepseek-official' }] })
    await bench.face.loadModels()

    expect(bench.session.modelCatalog).toHaveBeenCalledTimes(2)
  })

  it('reports a catalog the host refused', async () => {
    const bench = harness({ catalog: () => ({ ok: false, error: unavailable('socket closed') }) })

    await expect(bench.face.loadModels()).resolves.toBeNull()

    expect(bench.instance.getSnapshot().settingsFailure).toEqual({ code: 'settings-unavailable' })
  })
})
