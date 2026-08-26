/**
 * The plugin inventory tab's group store: user-defined plugin groups and the
 * selected group, persisted browser-locally across reloads. Module level
 * exports the factory only (a module-level handle would pin the store identity
 * across plugin reloads); register() receives the factory and the tab derives
 * its PropsStore share from the return type.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** One user-defined plugin group; members are stable Loader entry ids. */
export interface PluginGroup {
  readonly id: string
  readonly name: string
  readonly entryIds: string[]
}

/** The reserved selection value showing the whole inventory. */
export const ALL_GROUP = 'all'

/** Grouping state persisted across surface remounts and reloads. */
type PluginGroupsState = {
  groups: PluginGroup[]
  selection: string
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type PluginGroupsActions = {
  addGroup: (draft: PluginGroupsState, id: string, name: string) => void
  removeGroup: (draft: PluginGroupsState, id: string) => void
  addEntries: (draft: PluginGroupsState, id: string, entryIds: readonly string[]) => void
  removeEntry: (draft: PluginGroupsState, id: string, entryId: string) => void
  select: (draft: PluginGroupsState, selection: string) => void
}

/**
 * Create the plugin groups store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createPluginGroupsStore(): EngineStoreHandle<PluginGroupsState, PluginGroupsActions> {
  return defineStore({
    init: (): PluginGroupsState => ({ groups: [], selection: ALL_GROUP }),
    persist: 'dsh.plugin.groups.v1',
    actions: {
      // The caller mints the id (crypto.randomUUID in the component, a fixed
      // value in tests) so the action stays deterministic.
      addGroup: (d, id: string, name: string) => {
        d.groups.push({ id, name, entryIds: [] })
        d.selection = id
      },
      // Members are not deleted with the group: they simply show under 全部
      // again, since grouping is a display overlay.
      removeGroup: (d, id: string) => {
        d.groups = d.groups.filter(group => group.id !== id)
        if (d.selection === id) d.selection = ALL_GROUP
      },
      addEntries: (d, id: string, entryIds: readonly string[]) => {
        d.groups = d.groups.map(item => item.id === id
          ? { ...item, entryIds: [...new Set([...item.entryIds, ...entryIds])] }
          : item)
      },
      removeEntry: (d, id: string, entryId: string) => {
        d.groups = d.groups.map(item => item.id === id
          ? { ...item, entryIds: item.entryIds.filter(entry => entry !== entryId) }
          : item)
      },
      select: (d, selection: string) => { d.selection = selection },
    },
  })
}
