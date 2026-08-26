// @vitest-environment jsdom
/** Plugin groups store: action behavior plus localStorage persistence. */
import { beforeEach, describe, expect, it } from 'vitest'
import { ALL_GROUP, createPluginGroupsStore } from '../src/client/groups-store.ts'

beforeEach(() => { localStorage.clear() })

describe('createPluginGroupsStore', () => {
  it('starts on the 全部 selection with no groups', () => {
    const store = createPluginGroupsStore().create()
    expect(store.getSnapshot()).toEqual({ groups: [], selection: ALL_GROUP })
  })

  it('adds a group and selects it', () => {
    const store = createPluginGroupsStore().create()
    store.actions.addGroup('g1', '核心')
    expect(store.getSnapshot().groups).toEqual([{ id: 'g1', name: '核心', entryIds: [] }])
    expect(store.getSnapshot().selection).toBe('g1')
  })

  it('removes a group and falls back to 全部 only when it was selected', () => {
    const store = createPluginGroupsStore().create()
    store.actions.addGroup('g1', '核心')
    store.actions.addGroup('g2', '周边')
    store.actions.select('g1')
    store.actions.removeGroup('g2')
    expect(store.getSnapshot().groups.map(group => group.id)).toEqual(['g1'])
    expect(store.getSnapshot().selection).toBe('g1')
    store.actions.removeGroup('g1')
    expect(store.getSnapshot().selection).toBe(ALL_GROUP)
  })

  it('unions entries into a group and removes one back out', () => {
    const store = createPluginGroupsStore().create()
    store.actions.addGroup('g1', '核心')
    store.actions.addGroup('g2', '周边')
    store.actions.addEntries('g2', ['e9'])
    store.actions.addEntries('g1', ['e1', 'e2'])
    store.actions.addEntries('g1', ['e2', 'e3'])
    expect(store.getSnapshot().groups[0]?.entryIds).toEqual(['e1', 'e2', 'e3'])
    // Membership writes leave sibling groups untouched.
    expect(store.getSnapshot().groups[1]?.entryIds).toEqual(['e9'])
    store.actions.removeEntry('g1', 'e2')
    expect(store.getSnapshot().groups[0]?.entryIds).toEqual(['e1', 'e3'])
    expect(store.getSnapshot().groups[1]?.entryIds).toEqual(['e9'])
  })

  it('ignores membership writes to an unknown group', () => {
    const store = createPluginGroupsStore().create()
    store.actions.addEntries('ghost', ['e1'])
    store.actions.removeEntry('ghost', 'e1')
    expect(store.getSnapshot().groups).toEqual([])
  })

  it('rehydrates groups and selection from localStorage', () => {
    const first = createPluginGroupsStore().create()
    first.actions.addGroup('g1', '核心')
    first.actions.addEntries('g1', ['e1'])
    const second = createPluginGroupsStore().create()
    expect(second.getSnapshot().groups).toEqual([{ id: 'g1', name: '核心', entryIds: ['e1'] }])
    expect(second.getSnapshot().selection).toBe('g1')
  })
})
