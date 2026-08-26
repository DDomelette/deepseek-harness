import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button,
  IconChevronDownOutline14,
  IconCloseOutline16,
  IconPlusOutline16,
  IconSearchOutline16,
  Input,
  Modal,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { ALL_GROUP, createPluginGroupsStore } from './groups-store.ts'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginInventorySettingsTab.module.css'

/** Registration-side Remote face used by the section. */
export interface PluginInventorySettingsTabInjected {
  /** Read a current Host inventory snapshot. */
  list: () => Promise<PluginInventorySnapshot>
}

type PluginInventoryEntry = PluginInventorySnapshot['entries'][number]
type PluginFiberPhase = PluginInventoryEntry['fiberPhase']

/** Full component props assembled by the Settings slot renderer. */
export type PluginInventorySettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & PropsStore<ReturnType<typeof createPluginGroupsStore>>
  & InjectFace<PluginInventorySettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: PluginInventorySnapshot }

const PHASE_KEYS = {
  pending: 'pending',
  loading: 'loadingPhase',
  active: 'active',
  failed: 'failed',
  unloading: 'unloading',
} satisfies Record<Exclude<PluginFiberPhase, null>, PluginInventoryLocaleKey>

/** Localized accessible label for one root Fiber phase. */
function phaseLabel(
  phase: PluginFiberPhase,
  t: PluginInventorySettingsTabProps['t'],
): string {
  return phase === null ? t('unobserved') : t(PHASE_KEYS[phase])
}

/** Compact a module specifier without guessing whether its Loader id was generated. */
function moduleShortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped
    .replace(/^cordis:/, '')
    .replace(/^cordis-plugin-/, '')
    .replace(/^dsh-(?:host-|client-)?/, '')
}

/** Whether an inventory row matches the local catalog query. */
function matches(entry: PluginInventoryEntry, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  return [entry.moduleName, entry.entryId]
    .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

/** Render the read-only current Loader inventory with browser-local grouping. */
export function PluginInventorySettingsTab({ list, t, useStore, actions }: PluginInventorySettingsTabProps): ReactNode {
  const catalogId = useId()
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<PluginInventoryEntry['entryId'] | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerChecked, setPickerChecked] = useState<ReadonlySet<string>>(new Set())

  const groupsState = useStore(store => store)
  const selectedGroup = groupsState.groups.find(group => group.id === groupsState.selection)

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, request])

  const entries = state.status === 'ready' ? state.snapshot.entries : []
  const presentIds = useMemo(() => new Set<string>(entries.map(entry => entry.entryId)), [entries])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredEntries = useMemo(
    () => entries
      .filter(entry => selectedGroup === undefined || selectedGroup.entryIds.includes(entry.entryId))
      .filter(entry => matches(entry, normalizedQuery)),
    [entries, selectedGroup, normalizedQuery],
  )

  useEffect(() => {
    if (expanded !== null && !filteredEntries.some(entry => entry.entryId === expanded)) {
      setExpanded(null)
    }
  }, [expanded, filteredEntries])

  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  const trimmedGroupName = groupName.trim()
  const groupNameDuplicate = groupsState.groups.some(group => group.name === trimmedGroupName)
  const saveGroup = (): void => {
    /* v8 ignore next -- unreachable guard: the save button is disabled while the name is empty or duplicate. */
    if (trimmedGroupName.length === 0 || groupNameDuplicate) return
    actions.addGroup(crypto.randomUUID(), trimmedGroupName)
    setGroupDialogOpen(false)
    setGroupName('')
  }

  const pickerNormalized = pickerQuery.trim().toLocaleLowerCase()
  const pickerCandidates = selectedGroup === undefined
    ? []
    : entries
      .filter(entry => !selectedGroup.entryIds.includes(entry.entryId))
      .filter(entry => matches(entry, pickerNormalized))
  const togglePickerCheck = (entryId: string): void => {
    setPickerChecked((current) => {
      const next = new Set(current)
      if (next.has(entryId)) next.delete(entryId); else next.add(entryId)
      return next
    })
  }
  const closePicker = (): void => {
    setPickerOpen(false)
    setPickerQuery('')
    setPickerChecked(new Set())
  }
  const addPickedEntries = (): void => {
    /* v8 ignore next -- unreachable guard: the picker opens only for a selected group and its add button is disabled at zero checks. */
    if (selectedGroup === undefined || pickerChecked.size === 0) return
    actions.addEntries(selectedGroup.id, [...pickerChecked])
    closePicker()
  }

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <div className={css.columns}>
          <aside className={css.groupsPane}>
            <div className={css.paneHeading}>
              <h3>{t('groups')}</h3>
              <Tooltip label={t('groupAdd')}>
                <span className={css.actionAnchor}>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={t('groupAdd')}
                    onClick={() => { setGroupDialogOpen(true) }}
                  >
                    <IconPlusOutline16 />
                  </Button>
                </span>
              </Tooltip>
            </div>
            <ul className={css.groupList}>
              <li>
                <button
                  type="button"
                  className={css.groupRow}
                  data-selected={selectedGroup === undefined ? 'true' : undefined}
                  aria-current={selectedGroup === undefined ? 'true' : undefined}
                  onClick={() => { actions.select(ALL_GROUP) }}
                >
                  <span className={css.groupName}>{t('groupsAll')}</span>
                  <span className={css.groupCount}>{entries.length}</span>
                </button>
              </li>
              {groupsState.groups.map(group => (
                <li key={group.id} className={css.groupItem}>
                  <button
                    type="button"
                    className={css.groupRow}
                    data-selected={selectedGroup?.id === group.id ? 'true' : undefined}
                    aria-current={selectedGroup?.id === group.id ? 'true' : undefined}
                    onClick={() => { actions.select(group.id) }}
                  >
                    <span className={css.groupName}>{group.name}</span>
                    <span className={css.groupCount}>
                      {group.entryIds.filter(id => presentIds.has(id)).length}
                    </span>
                  </button>
                  <Tooltip label={t('groupDelete')}>
                    <button
                      type="button"
                      className={css.groupDelete}
                      aria-label={`${t('groupDelete')} ${group.name}`}
                      onClick={() => { actions.removeGroup(group.id) }}
                    >
                      <IconCloseOutline16 size={12} />
                    </button>
                  </Tooltip>
                </li>
              ))}
            </ul>
          </aside>
          <div className={css.catalog}>
            <div className={css.catalogHeading}>
              <h3>{t('plugins')}</h3>
              <span data-plugin-count={filteredEntries.length}>{filteredEntries.length}</span>
              {selectedGroup === undefined ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  className={css.addPlugins}
                  onClick={() => { setPickerOpen(true) }}
                >
                  <IconPlusOutline16 size={12} />
                  {t('addPlugins')}
                </Button>
              )}
            </div>
            <label className={css.search}>
              <IconSearchOutline16 aria-hidden="true" />
              <span className={css.visuallyHidden}>{t('search')}</span>
              <input
                type="search"
                value={query}
                placeholder={t('search')}
                aria-label={t('search')}
                onChange={(event) => { setQuery(event.currentTarget.value) }}
              />
            </label>
            {entries.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
            {entries.length > 0 && selectedGroup !== undefined && selectedGroup.entryIds.length === 0
              ? <p className={css.status}>{t('emptyGroup')}</p>
              : null}
            {filteredEntries.length === 0
              && !(selectedGroup !== undefined && selectedGroup.entryIds.length === 0)
              && (normalizedQuery.length > 0 || selectedGroup !== undefined)
              && entries.length > 0
              ? <p className={css.status}>{t('emptySearch')}</p>
              : null}
            {filteredEntries.length > 0 ? (
              <ul className={css.cards}>
                {filteredEntries.map((entry) => {
                  const status = phaseLabel(entry.fiberPhase, t)
                  const title = moduleShortName(entry.moduleName)
                  const configuration = t(entry.enabled ? 'enabledTag' : 'disabledTag')
                  const open = expanded === entry.entryId
                  const detailId = `${catalogId}-details-${encodeURIComponent(entry.entryId)}`
                  return (
                    <li
                      className={css.card}
                      key={entry.entryId}
                      data-plugin-entry={entry.entryId}
                      data-open={open ? 'true' : undefined}
                    >
                      <div className={css.cardRow}>
                        <button
                          className={css.cardContent}
                          type="button"
                          aria-expanded={open}
                          aria-controls={detailId}
                          aria-label={entry.enabled ? `${title}, ${status}, ${configuration}` : `${title}, ${configuration}`}
                          onClick={() => {
                            setExpanded(current => current === entry.entryId ? null : entry.entryId)
                          }}
                        >
                          <strong className={css.cardTitle} title={entry.moduleName}>{title}</strong>
                          <span className={css.cardTrailing}>
                            {entry.enabled ? (
                              <span
                                className={css.statusDot}
                                data-phase={entry.fiberPhase ?? 'unobserved'}
                                role="img"
                                aria-label={status}
                                title={status}
                              />
                            ) : null}
                            <span className={css.configTag} data-enabled={entry.enabled ? 'true' : 'false'}>
                              {configuration}
                            </span>
                            <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
                          </span>
                        </button>
                        {selectedGroup === undefined ? null : (
                          <Tooltip label={t('removeFromGroup')}>
                            <button
                              type="button"
                              className={css.removeEntry}
                              aria-label={`${t('removeFromGroup')} ${title}`}
                              onClick={() => { actions.removeEntry(selectedGroup.id, entry.entryId) }}
                            >
                              <IconCloseOutline16 size={12} />
                            </button>
                          </Tooltip>
                        )}
                      </div>
                      {open ? (
                        <div className={css.cardDetails} id={detailId}>
                          <code className={css.entryValue} data-loader-entry>{entry.entryId}</code>
                          <dl className={css.details}>
                            <div>
                              <dt>{t('configuration')}</dt>
                              <dd>{configuration}</dd>
                            </div>
                            {entry.enabled ? (
                              <div>
                                <dt>{t('cordis')}</dt>
                                <dd>{status}</dd>
                              </div>
                            ) : null}
                          </dl>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
      <Modal
        open={groupDialogOpen}
        title={t('groupDialogTitle')}
        closeLabel={t('cancel')}
        onClose={() => { setGroupDialogOpen(false); setGroupName('') }}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setGroupDialogOpen(false); setGroupName('') }}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={trimmedGroupName.length === 0 || groupNameDuplicate}
              onClick={saveGroup}
            >
              {t('save')}
            </Button>
          </>
        )}
      >
        <Input
          value={groupName}
          placeholder={t('groupNamePlaceholder')}
          aria-label={t('groupNamePlaceholder')}
          onChange={(event) => { setGroupName(event.currentTarget.value) }}
        />
      </Modal>
      <Modal
        open={pickerOpen && selectedGroup !== undefined}
        title={t('pickerTitle')}
        closeLabel={t('cancel')}
        onClose={closePicker}
        footer={(
          <div className={css.pickerFooter}>
            <span className={css.pickerCount}>
              {t('pickerSelected').replace('{count}', String(pickerChecked.size))}
            </span>
            <span className={css.pickerActions}>
              <Button variant="outline" onClick={closePicker}>{t('cancel')}</Button>
              <Button variant="primary" disabled={pickerChecked.size === 0} onClick={addPickedEntries}>
                {t('add')}
              </Button>
            </span>
          </div>
        )}
      >
        <div className={css.pickerBody}>
          <Input
            icon={<IconSearchOutline16 />}
            value={pickerQuery}
            placeholder={t('search')}
            aria-label={t('search')}
            onChange={(event) => { setPickerQuery(event.currentTarget.value) }}
          />
          {selectedGroup !== undefined && entries.length > selectedGroup.entryIds.length
            ? null
            : <p className={css.status}>{t('pickerEmpty')}</p>}
          {pickerCandidates.length === 0 && pickerNormalized.length > 0
            ? <p className={css.status}>{t('pickerNoMatch')}</p>
            : null}
          {pickerCandidates.length > 0 ? (
            <ul className={css.pickerList}>
              {pickerCandidates.map(entry => (
                <li key={entry.entryId}>
                  <label className={css.pickerRow}>
                    <span className={css.pickerName} title={entry.moduleName}>
                      {moduleShortName(entry.moduleName)}
                    </span>
                    <input
                      type="checkbox"
                      className={css.pickerCheck}
                      checked={pickerChecked.has(entry.entryId)}
                      aria-label={moduleShortName(entry.moduleName)}
                      onChange={() => { togglePickerCheck(entry.entryId) }}
                    />
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}
