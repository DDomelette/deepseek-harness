/** Browser-local group selection and membership editing over the Host inventory. */

import { useState, type ReactNode } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { ALL_GROUP, type PluginGroup, type createPluginGroupsStore } from './groups-store.ts'
import type { PluginInventorySettingsTabProps } from './PluginInventorySettingsTab.tsx'
import css from './PluginGroupControls.module.css'

interface InventoryMember {
  readonly key: string
  readonly legacy?: string
  readonly label: string
}

/**
 * Edit persistent presentation groups without changing Host plugin configuration.
 * @param props - inventory rows, group state, store actions and translated copy.
 * @returns group toolbar and its name and membership dialogs.
 */
export function PluginGroupControls({ groups, selected, entries, actions, t }: {
  readonly groups: readonly PluginGroup[]
  readonly selected: string
  readonly entries: readonly InventoryMember[]
  readonly actions: PropsStore<ReturnType<typeof createPluginGroupsStore>>['actions']
  readonly t: PluginInventorySettingsTabProps['t']
}): ReactNode {
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const group = groups.find(candidate => candidate.id === selected)
  const normalized = query.trim().toLocaleLowerCase()
  const available = [...new Map(entries.map(entry => [entry.key, entry])).values()]
    .filter(entry => entry.label.toLocaleLowerCase().includes(normalized))
  return (
    <div className={css.toolbar}>
      <label>
        <span className={css.label}>{t('groups')}</span>
        <select value={selected} onChange={(event) => { actions.select(event.currentTarget.value) }}>
          <option value={ALL_GROUP}>{t('groupsAll')}</option>
          {groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <Button onClick={() => { setName(''); setCreating(true) }}>{t('groupAdd')}</Button>
      {group !== undefined && <>
        <Button onClick={() => { setQuery(''); setEditing(true) }}>{t('addPlugins')}</Button>
        <Button onClick={() => { actions.removeGroup(group.id) }}>{t('groupDelete')}</Button>
      </>}
      <Modal title={t('groupDialogTitle')} open={creating} onClose={() => { setCreating(false) }} closeLabel={t('cancel')}>
        <form className={css.dialog} onSubmit={(event) => {
          event.preventDefault()
          if (name.trim() === '') return
          actions.addGroup(randomUUID(), name.trim())
          setCreating(false)
        }}>
          <input autoFocus value={name} aria-label={t('groupNamePlaceholder')}
            placeholder={t('groupNamePlaceholder')} onChange={(event) => { setName(event.currentTarget.value) }} />
          <Button type="submit" disabled={name.trim() === ''}>{t('save')}</Button>
        </form>
      </Modal>
      <Modal title={t('pickerTitle')} open={editing && group !== undefined} onClose={() => { setEditing(false) }} closeLabel={t('cancel')}>
        <div className={css.dialog}>
          <input type="search" value={query} aria-label={t('search')}
            placeholder={t('search')} onChange={(event) => { setQuery(event.currentTarget.value) }} />
          <div className={css.members}>
            {available.length === 0 && <p>{t('pickerNoMatch')}</p>}
            {available.map(entry => <label key={entry.key} className={css.member}>
              <input type="checkbox" checked={group?.entryIds.includes(entry.key)
                || (entry.legacy !== undefined && group?.entryIds.includes(entry.legacy)) || false}
              onChange={(event) => {
                if (group === undefined) return
                if (event.currentTarget.checked) actions.addEntries(group.id, [entry.key])
                else {
                  actions.removeEntry(group.id, entry.key)
                  if (entry.legacy !== undefined) actions.removeEntry(group.id, entry.legacy)
                }
              }} />
              <span>{entry.label}</span>
            </label>)}
          </div>
          <Button onClick={() => { setEditing(false) }}>{t('done')}</Button>
        </div>
      </Modal>
    </div>
  )
}
