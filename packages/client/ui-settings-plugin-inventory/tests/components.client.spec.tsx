// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createPluginGroupsStore } from '../src/client/groups-store.ts'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'
import type {
  PluginInventorySettingsTabInjected,
  PluginInventorySettingsTabProps,
} from '../src/client/PluginInventorySettingsTab.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

type Snapshot = Awaited<ReturnType<PluginInventorySettingsTabInjected['list']>>
const t = ((key: PluginInventoryLocaleKey): string => en[key]) as PluginInventorySettingsTabProps['t']

function mount(list: PluginInventorySettingsTabInjected['list']) {
  const store = createPluginGroupsStore().create()
  const props = {
    t,
    list,
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
  } as PluginInventorySettingsTabProps
  const view = render(<PluginInventorySettingsTab {...props} />)
  return { view, store }
}

const SNAPSHOT = {
  entries: [
    { entryId: '8a1b2c3d', moduleName: '@deepseek-ai/cordis-plugin-hmr', enabled: true, fiberPhase: 'active' },
    { entryId: 'pending', moduleName: 'cordis:pending-name', enabled: true, fiberPhase: 'pending' },
    { entryId: 'loading', moduleName: '@fixture/loading-name', enabled: true, fiberPhase: 'loading' },
    { entryId: 'failed', moduleName: '@fixture/failed-name', enabled: true, fiberPhase: 'failed' },
    { entryId: 'unloading', moduleName: '@fixture/unloading-name', enabled: true, fiberPhase: 'unloading' },
    { entryId: 'unobserved', moduleName: '@fixture/unobserved-name', enabled: true, fiberPhase: null },
    { entryId: 'disabled-entry', moduleName: '@deepseek-ai/dsh-host-directory-picker-native', enabled: false, fiberPhase: null },
  ],
} as unknown as Snapshot

const cardEntries = (): HTMLElement[] =>
  [...document.querySelectorAll('[data-plugin-entry]')] as HTMLElement[]

describe('PluginInventorySettingsTab', () => {
  it('renders runtime status only for enabled plugins', async () => {
    const deferred = Promise.withResolvers<Snapshot>()
    const list = vi.fn(() => deferred.promise)
    const { view } = mount(list)
    expect(screen.getByText(en.loading)).toBeTruthy()

    await act(async () => { deferred.resolve(SNAPSHOT) })
    expect(list).toHaveBeenCalledOnce()
    expect(screen.getByRole('searchbox', { name: en.search })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.plugins })).toBeTruthy()
    expect(view.container.querySelector('[data-plugin-count]')?.textContent).toBe('7')
    expect(cardEntries()).toHaveLength(7)
    expect(screen.getAllByText(en.enabledTag)).toHaveLength(6)
    expect(screen.getByText(en.disabledTag)).toBeTruthy()
    for (const value of [
      'Mounted',
      'Waiting for dependencies',
      'Loading',
      'Mount failed',
      'Unloading',
      'Not mounted',
    ]) {
      expect(screen.getByRole('img', { name: value })).toBeTruthy()
    }
    const active = screen.getByRole('button', { name: 'hmr, Mounted, Enabled' })
    expect(active.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(active)
    expect(active.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.querySelector('[data-loader-entry]')?.textContent).toBe('8a1b2c3d')
    expect(screen.getByText(en.configuration)).toBeTruthy()
    expect(screen.getByText(en.cordis)).toBeTruthy()
    fireEvent.click(active)
    expect(view.container.querySelector('[data-loader-entry]')).toBeNull()

    fireEvent.click(active)
    fireEvent.change(screen.getByRole('searchbox', { name: en.search }), {
      target: { value: 'disabled-entry' },
    })
    expect(view.container.querySelector('[data-loader-entry]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'directory-picker-native, Disabled' }))
    expect(screen.getAllByText(en.disabledTag)).toHaveLength(2)
    expect(screen.queryByText(en.cordis)).toBeNull()
    expect(screen.queryByText(en.unobserved)).toBeNull()
  })

  it('filters by module name or Loader entry id', async () => {
    mount(async () => SNAPSHOT)
    const search = await screen.findByRole('searchbox', { name: en.search })

    fireEvent.change(search, { target: { value: 'disabled-entry' } })
    expect(cardEntries()).toHaveLength(1)
    expect(screen.getByText('directory-picker-native')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'cordis-plugin-hmr' } })
    expect(cardEntries()).toHaveLength(1)
    expect(screen.getByText('hmr')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'not-a-plugin' } })
    expect(cardEntries()).toHaveLength(0)
    expect(screen.getByText(en.emptySearch)).toBeTruthy()
  })

  it('shows a generic failure and retries into the empty state', async () => {
    const list = vi.fn<PluginInventorySettingsTabInjected['list']>()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValueOnce({ entries: [] })
    mount(list)

    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    expect(screen.queryByText('private transport detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(en.empty)).toBeTruthy()
  })

  it('contains a synchronous Remote failure and ignores a result after unmount', async () => {
    const syncFailure = vi.fn(() => { throw new Error('namespace unavailable') }) as PluginInventorySettingsTabInjected['list']
    const failed = mount(syncFailure)
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    failed.view.unmount()

    const deferred = Promise.withResolvers<Snapshot>()
    const pending = mount(() => deferred.promise)
    pending.view.unmount()
    await act(async () => { deferred.resolve(SNAPSHOT) })

    const deferredFailure = Promise.withResolvers<Snapshot>()
    const pendingFailure = mount(() => deferredFailure.promise)
    pendingFailure.view.unmount()
    await act(async () => { deferredFailure.reject(new Error('late failure')) })
  })

  it('creates a group from the dialog and selects it', async () => {
    const { store } = mount(async () => SNAPSHOT)
    await screen.findByRole('searchbox', { name: en.search })
    // The groups column defaults to 全部 with the total count.
    expect(screen.getByRole('heading', { name: en.groups })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^All/ }).getAttribute('aria-current')).toBe('true')
    expect(screen.queryByRole('button', { name: en.addPlugins })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.groupAdd }))
    const dialog = screen.getByRole('dialog', { name: en.groupDialogTitle })
    const save = screen.getByRole('button', { name: en.save })
    expect(save.hasAttribute('disabled')).toBe(true)
    fireEvent.change(dialog.querySelector('input') as HTMLElement, { target: { value: '  核心  ' } })
    expect(save.hasAttribute('disabled')).toBe(false)
    fireEvent.click(save)

    expect(store.getSnapshot().groups).toHaveLength(1)
    expect(store.getSnapshot().groups[0]?.name).toBe('核心')
    const groupId = store.getSnapshot().groups[0]?.id ?? ''
    expect(store.getSnapshot().selection).toBe(groupId)
    expect(screen.getByRole('button', { name: '核心0' }).getAttribute('aria-current')).toBe('true')
    // A fresh group is empty: the add button appears and the hint shows.
    expect(screen.getByRole('button', { name: en.addPlugins })).toBeTruthy()
    expect(screen.getByText(en.emptyGroup)).toBeTruthy()

    // Duplicate names cannot be saved.
    fireEvent.click(screen.getByRole('button', { name: en.groupAdd }))
    fireEvent.change(screen.getByRole('dialog', { name: en.groupDialogTitle }).querySelector('input') as HTMLElement, {
      target: { value: '核心' },
    })
    expect(screen.getByRole('button', { name: en.save }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByText(en.cancel))
    expect(screen.queryByRole('dialog')).toBeNull()

    // Selection moves through row clicks, and Escape closes the dialog.
    fireEvent.click(screen.getByRole('button', { name: /^All/ }))
    expect(screen.getByRole('button', { name: /^All/ }).getAttribute('aria-current')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '核心0' }))
    expect(screen.getByRole('button', { name: '核心0' }).getAttribute('aria-current')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: en.groupAdd }))
    fireEvent.change(screen.getByRole('dialog', { name: en.groupDialogTitle }).querySelector('input') as HTMLElement, {
      target: { value: '草稿' },
    })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(store.getSnapshot().groups).toHaveLength(1)
  })

  it('adds picked plugins through the searchable picker and removes one back out', async () => {
    const { store } = mount(async () => SNAPSHOT)
    await screen.findByRole('searchbox', { name: en.search })
    store.actions.addGroup('g1', '核心')
    await screen.findByRole('button', { name: en.addPlugins })

    fireEvent.click(screen.getByRole('button', { name: en.addPlugins }))
    expect(screen.getByRole('dialog', { name: en.pickerTitle })).toBeTruthy()
    expect(screen.getByText(en.pickerSelected.replace('{count}', '0'))).toBeTruthy()
    expect(screen.getByRole('button', { name: en.add }).hasAttribute('disabled')).toBe(true)
    expect(screen.getAllByRole('checkbox')).toHaveLength(7)

    // The picker search narrows candidates; checks accumulate across queries.
    fireEvent.change(screen.getByRole('textbox', { name: en.search }), { target: { value: 'hmr' } })
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    fireEvent.click(screen.getByRole('checkbox', { name: 'hmr' }))
    fireEvent.change(screen.getByRole('textbox', { name: en.search }), { target: { value: 'zzz' } })
    expect(screen.getByText(en.pickerNoMatch)).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: en.search }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'loading-name' }))
    expect(screen.getByText(en.pickerSelected.replace('{count}', '2'))).toBeTruthy()
    // Unchecking returns the count.
    fireEvent.click(screen.getByRole('checkbox', { name: 'loading-name' }))
    expect(screen.getByText(en.pickerSelected.replace('{count}', '1'))).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'loading-name' }))

    fireEvent.click(screen.getByRole('button', { name: en.add }))
    expect(store.getSnapshot().groups[0]?.entryIds).toEqual(['8a1b2c3d', 'loading'])
    expect(screen.queryByRole('dialog')).toBeNull()
    // The group now filters the catalog to its members.
    expect(cardEntries()).toHaveLength(2)

    // Members leave the picker candidates.
    fireEvent.click(screen.getByRole('button', { name: en.addPlugins }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(5)
    fireEvent.click(screen.getByText(en.cancel))

    // Remove one member from the group through the card affordance.
    fireEvent.click(screen.getByRole('button', { name: `${en.removeFromGroup} hmr` }))
    expect(store.getSnapshot().groups[0]?.entryIds).toEqual(['loading'])
    expect(cardEntries()).toHaveLength(1)
  })

  it('reports an empty picker when every plugin is already grouped', async () => {
    const { store } = mount(async () => SNAPSHOT)
    await screen.findByRole('searchbox', { name: en.search })
    store.actions.addGroup('g1', '核心')
    store.actions.addEntries('g1', SNAPSHOT.entries.map(entry => entry.entryId))
    fireEvent.click(await screen.findByRole('button', { name: en.addPlugins }))
    expect(screen.getByText(en.pickerEmpty)).toBeTruthy()
    fireEvent.click(screen.getByText(en.cancel))
  })

  it('deletes a group and falls back to 全部 with every plugin visible', async () => {
    const { store } = mount(async () => SNAPSHOT)
    await screen.findByRole('searchbox', { name: en.search })
    store.actions.addGroup('g1', '核心')
    store.actions.addEntries('g1', ['8a1b2c3d'])
    await screen.findByRole('button', { name: `${en.groupDelete} 核心` })
    expect(cardEntries()).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: `${en.groupDelete} 核心` }))
    expect(store.getSnapshot().groups).toEqual([])
    expect(store.getSnapshot().selection).toBe('all')
    expect(screen.getByRole('button', { name: /^All/ }).getAttribute('aria-current')).toBe('true')
    expect(cardEntries()).toHaveLength(7)
  })
})
