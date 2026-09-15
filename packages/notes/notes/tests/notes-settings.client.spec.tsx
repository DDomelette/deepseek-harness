// @vitest-environment jsdom
/**
 * The settings card: what one deployment's notes section resolves to, and the
 * three fields a reader can change from it, plus the commands behind them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NotesSettingsCard } from '../src/client/NotesSettingsCard.tsx'
import type { NotesActionView } from '../src/types.ts'
import { harness, settings, unavailable } from './fixtures.client.ts'

afterEach(cleanup)

/** The collection action the default fixture section carries. */
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

describe('notes settings card', () => {
  it('shows the strategy, the workspace, and the collection actions', async () => {
    const bench = harness()
    await opened(bench)

    expect(document.querySelector('[data-notes-strategy="manual"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('[data-notes-strategy="auto"]')?.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByLabelText<HTMLInputElement>('settings.workspace').value).toBe('/work/notes')
    // An action's label and prompt are what the reader edits, so they are the
    // fields' values rather than a read-only line.
    expect(screen.getByLabelText<HTMLInputElement>('settings.actionLabel(action=translate)').value).toBe('翻译')
    expect(screen.getByLabelText<HTMLTextAreaElement>('settings.actionPrompt(action=translate)').value)
      .toBe('不改变语句结构，翻译下列内容：')
    expect(screen.getByText('settings.autoSend')).toBeDefined()
  })

  it('leaves the workspace field empty while none is configured', async () => {
    const bench = harness({ settings: () => settings({ workspace: null }) })
    await opened(bench)

    expect(screen.getByLabelText<HTMLInputElement>('settings.workspace').value).toBe('')
  })

  it('names an action that only adds', async () => {
    const bench = harness({
      settings: () => settings({
        actions: [{ id: 'clip', label: '剪藏', prompt: '保存：', autoSend: false }],
      }),
    })
    await opened(bench)

    expect(screen.getByText('settings.manualSend')).toBeDefined()
    expect(screen.queryByText('settings.autoSend')).toBeNull()
  })

  it('saves a strategy change', async () => {
    const bench = harness()
    const save = vi.spyOn(bench.props(), 'saveSettings')
    await opened(bench)

    fireEvent.click(document.querySelector('[data-notes-strategy="auto"]')!)

    expect(save).toHaveBeenCalledExactlyOnceWith({ strategy: 'auto' })
  })

  it('edits one action\'s label and prompt, and keeps the others as stored', async () => {
    const clip: NotesActionView = { id: 'clip', label: '剪藏', prompt: '保存：', autoSend: false }
    const bench = harness({ settings: () => settings({ actions: [TRANSLATE, clip] }) })
    const save = vi.spyOn(bench.props(), 'saveSettings')
    await opened(bench)

    fireEvent.change(screen.getByLabelText('settings.actionLabel(action=translate)'), { target: { value: '译' } })
    fireEvent.change(screen.getByLabelText('settings.actionPrompt(action=translate)'), { target: { value: '翻译下面这段：' } })
    fireEvent.click(document.querySelector('[data-notes-save-action="translate"]') as Element)

    expect(save).toHaveBeenCalledExactlyOnceWith({
      actions: [{ ...TRANSLATE, label: '译', prompt: '翻译下面这段：' }, clip],
    })
  })

  it('keeps an action\'s save disabled until its copy changes', async () => {
    const bench = harness()
    await opened(bench)

    expect(document.querySelector('[data-notes-save-action="translate"]')?.hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByLabelText('settings.actionLabel(action=translate)'), { target: { value: '译' } })

    expect(document.querySelector('[data-notes-save-action="translate"]')?.hasAttribute('disabled')).toBe(false)
  })

  it('keeps an action\'s save disabled while a field is blank', async () => {
    const bench = harness()
    await opened(bench)

    fireEvent.change(screen.getByLabelText('settings.actionPrompt(action=translate)'), { target: { value: '   ' } })

    expect(document.querySelector('[data-notes-save-action="translate"]')?.hasAttribute('disabled')).toBe(true)
  })

  it('saves the workspace, and clears it when the field is emptied', async () => {
    const bench = harness()
    const save = vi.spyOn(bench.props(), 'saveSettings')
    await opened(bench)

    const field = screen.getByLabelText('settings.workspace')
    fireEvent.change(field, { target: { value: '/work/other' } })
    fireEvent.click(screen.getByText('settings.saveWorkspace'))
    expect(save).toHaveBeenCalledExactlyOnceWith({ workspace: '/work/other' })

    fireEvent.change(field, { target: { value: '' } })
    fireEvent.click(screen.getByText('settings.saveWorkspace'))
    expect(save).toHaveBeenLastCalledWith({ workspace: null })
  })

  it('saves a model override once both names are given', async () => {
    const bench = harness()
    const save = vi.spyOn(bench.props(), 'saveSettings')
    await opened(bench)

    const button = screen.getByText('settings.saveModel')
    expect((button as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('settings.provider'), { target: { value: 'deepseek' } })
    fireEvent.change(screen.getByLabelText('settings.modelName'), { target: { value: 'deepseek-flash' } })
    fireEvent.click(button)

    expect(save).toHaveBeenCalledExactlyOnceWith({ model: { provider: 'deepseek', model: 'deepseek-flash' } })
  })

  it('clears a model override the deployment had set', async () => {
    const bench = harness({
      settings: () => settings({ model: { provider: 'deepseek', model: 'deepseek-flash' } }),
    })
    const save = vi.spyOn(bench.props(), 'saveSettings')
    await opened(bench)

    expect(screen.getByLabelText<HTMLInputElement>('settings.provider').value).toBe('deepseek')
    fireEvent.click(screen.getByText('settings.clearModel'))

    expect(save).toHaveBeenCalledExactlyOnceWith({ model: null })
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

  it('says a section is read-only when the deployment cannot persist a write', async () => {
    const bench = harness({ settings: () => settings({ writable: false }) })
    await opened(bench)

    expect(document.querySelector('[data-notes-settings-readonly]')).not.toBeNull()
    expect(screen.getByText('settings.readOnly')).toBeDefined()
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
