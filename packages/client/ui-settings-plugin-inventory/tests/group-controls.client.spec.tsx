// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, onTestFinished } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { PluginGroupControls } from '../src/client/PluginGroupControls.tsx'
import { ALL_GROUP, createPluginGroupsStore } from '../src/client/groups-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function renderControls() {
  const key = 'dsh.plugin.groups.v1'
  const previous = localStorage.getItem(key)
  onTestFinished(() => {
    if (previous === null) localStorage.removeItem(key)
    else localStorage.setItem(key, previous)
  })
  localStorage.removeItem(key)
  const store = createPluginGroupsStore().create()
  const useGroups = bindSnapshotSelector(store)
  const entries = [
    { key: 'global:timer', legacy: 'timer', label: 'Timer' },
    { key: 'preset:tools', label: 'Tools' },
    { key: 'global:timer', legacy: 'timer', label: 'Timer' },
  ]
  function Controls() {
    const state = useGroups(snapshot => snapshot)
    return <PluginGroupControls groups={state.groups} selected={state.selection} entries={entries}
      actions={store.actions} t={makeTranslate(en)} />
  }
  render(<Controls />)
  return store
}

it('creates a named group, edits current and legacy membership, and deletes only the group', () => {
  const store = renderControls()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: ALL_GROUP } })
  fireEvent.click(screen.getByRole('button', { name: en.groupAdd }))
  const input = screen.getByRole('textbox', { name: en.groupNamePlaceholder })
  expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
  fireEvent.submit(input.closest('form')!)
  expect(store.getSnapshot().groups).toEqual([])
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.groupAdd }))
  fireEvent.change(screen.getByRole('textbox', { name: en.groupNamePlaceholder }), { target: { value: '  Favorites  ' } })
  fireEvent.click(screen.getByRole('button', { name: en.save }))
  const group = store.getSnapshot().groups[0]!
  expect(group.name).toBe('Favorites')
  expect(store.getSnapshot().selection).toBe(group.id)
  expect(screen.queryByRole('dialog')).toBeNull()

  act(() => { store.actions.addEntries(group.id, ['timer']) })
  fireEvent.click(screen.getByRole('button', { name: en.addPlugins }))
  const picker = screen.getByRole('dialog', { name: en.pickerTitle })
  expect(within(picker).getAllByRole('checkbox')).toHaveLength(2)
  const timer = within(picker).getByRole('checkbox', { name: 'Timer' })
  expect(timer).toHaveProperty('checked', true)
  fireEvent.click(timer)
  expect(store.getSnapshot().groups[0]!.entryIds).toEqual([])
  fireEvent.click(timer)
  const tools = within(picker).getByRole('checkbox', { name: 'Tools' })
  fireEvent.click(tools)
  expect(store.getSnapshot().groups[0]!.entryIds).toEqual(['global:timer', 'preset:tools'])
  fireEvent.click(tools)
  expect(store.getSnapshot().groups[0]!.entryIds).toEqual(['global:timer'])

  const search = within(picker).getByRole('searchbox', { name: en.search })
  fireEvent.change(search, { target: { value: 'unknown' } })
  expect(within(picker).getByText(en.pickerNoMatch)).toBeTruthy()
  fireEvent.change(search, { target: { value: ' TIMER ' } })
  expect(within(picker).getAllByRole('checkbox')).toHaveLength(1)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.addPlugins }))
  expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: en.done }))
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.groupDelete }))
  expect(store.getSnapshot()).toEqual({ selection: ALL_GROUP, groups: [] })
})

it('closes the membership dialog if its selected group is removed', () => {
  const store = renderControls()
  act(() => { store.actions.addGroup('selected', 'Selected') })
  fireEvent.click(screen.getByRole('button', { name: en.addPlugins }))
  expect(screen.getByRole('dialog', { name: en.pickerTitle })).toBeTruthy()
  act(() => { store.actions.removeGroup('selected') })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(store.getSnapshot().groups).toEqual([])
})
