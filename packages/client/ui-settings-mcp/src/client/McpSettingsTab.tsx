/**
 * MCP server roster tab: settings-managed rows with hot enablement switches
 * plus read-only cordis.yml-declared rows, over the `mcpServers` Remote
 * snapshot. The status dot reports mount lifecycle only — a settled ('ready')
 * mount is not a proven live connection.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  McpServerListEntry, McpServerSnapshot, McpServerStatus,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button, IconPlusOutline16, IconSearchOutline16, IconSettingsOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { AddServerForm, type NewServerDraft } from './AddServerForm.tsx'
import { EditServerForm, type ServerPatch } from './EditServerForm.tsx'
import type { McpServerSettingsEntry } from './mcp-tab-controller.ts'
import type { McpLocaleKey } from './locales.ts'
import css from './McpSettingsTab.module.css'

/** Registration-side face the MCP tab's slot entry injects. */
export interface McpSettingsTabInjected {
  /** Read a current Host roster snapshot (settings-managed and declarative rows). */
  list: () => Promise<McpServerSnapshot>
  /**
   * Subscribe to Host roster invalidations and connection resets.
   * @param listener - callback that refetches the point-in-time roster.
   * @returns disposer for both invalidation sources.
   */
  subscribeRoster: (listener: () => void) => () => void
  /**
   * Write one settings-managed row's enablement through the settings scope.
   * @param serverName - the row's server name.
   * @param enabled - the target enablement.
   * @returns settlement of the queued settings write.
   */
  setEnabled: (serverName: string, enabled: boolean) => Promise<void>
  /**
   * Persist one new server from a validated form draft.
   * @param draft - the composed entry, secrets included.
   * @returns null on acceptance, otherwise the locale key of the failure.
   */
  addServer: (draft: NewServerDraft) => Promise<McpLocaleKey | null>
  /**
   * Read one settings-managed row's redacted entry for the edit form.
   * @param serverName - the row's server name.
   * @returns the accepted redacted entry, or undefined while the scope holds none.
   */
  readEntry: (serverName: string) => McpServerSettingsEntry | undefined
  /**
   * Apply one incremental patch as per-field path ops; unchanged and blank
   * secret fields keep their stored values.
   * @param serverName - the row's server name.
   * @param patch - the fields the user changed.
   * @returns null after the writes, otherwise the locale key of the failure.
   */
  updateServer: (serverName: string, patch: ServerPatch) => Promise<McpLocaleKey | null>
  /**
   * Remove one settings-managed server entry.
   * @param serverName - the row's server name.
   * @returns settlement of the queued settings clear.
   */
  removeServer: (serverName: string) => Promise<McpLocaleKey | null>
}

/** Full component props assembled by the Settings slot renderer. */
export type McpSettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.mcp'>
  & InjectFace<McpSettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: McpServerSnapshot }

/** Locale key of each mount-lifecycle status. */
const STATUS_KEYS = {
  connecting: 'connecting',
  ready: 'ready',
  failed: 'failed',
} satisfies Record<McpServerStatus, McpLocaleKey>

/** Whether a roster row matches the local name query. */
function matches(entry: McpServerListEntry, normalizedQuery: string): boolean {
  return normalizedQuery.length === 0
    || entry.serverName.toLocaleLowerCase().includes(normalizedQuery)
}

/** Render the MCP server roster with search, per-row switches, and the add entry. */
export function McpSettingsTab({
  list, subscribeRoster, setEnabled, addServer, readEntry, updateServer, removeServer, t,
}: McpSettingsTabProps): ReactNode {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const generation = useRef(0)
  const active = useRef(true)

  const refresh = useCallback(async (showLoading = false): Promise<void> => {
    if (!active.current) return
    const current = ++generation.current
    if (showLoading) setState({ status: 'loading' })
    try {
      const snapshot = await Promise.resolve().then(() => list())
      if (current === generation.current) setState({ status: 'ready', snapshot })
    } catch (_rosterReadFailure) {
      if (current === generation.current) setState({ status: 'error' })
    }
  }, [list])

  useEffect(() => {
    void refresh(true)
  }, [refresh])

  useEffect(() => () => {
    active.current = false
    generation.current += 1
  }, [])

  useEffect(
    () => subscribeRoster(() => { void refresh() }),
    [refresh, subscribeRoster],
  )

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredEntries = useMemo(
    () => state.status === 'ready'
      ? state.snapshot.entries.filter(entry => matches(entry, normalizedQuery))
      : [],
    [normalizedQuery, state],
  )

  const retry = (): void => {
    void refresh(true)
  }

  // Flip a row, then re-read the roster either way: the Host answers the new
  // mount lifecycle asynchronously, and the roster is the authority even for
  // a refused write. A failed refresh falls back to the retryable error state.
  const toggle = (entry: McpServerListEntry): void => {
    setPending(entry.serverName)
    let write: Promise<void>
    try {
      write = Promise.resolve(setEnabled(entry.serverName, !entry.enabled))
    } catch (_synchronousWriteFailure) {
      write = Promise.resolve()
    }
    void write
      .then(() => refresh(), () => refresh())
      .then(() => { if (active.current) setPending(null) })
  }

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      {adding && state.status === 'ready' ? (
        <AddServerForm
          existingNames={state.snapshot.entries.map(entry => entry.serverName)}
          addServer={addServer}
          t={t}
          onDone={() => {
            setAdding(false)
            void refresh()
          }}
          onCancel={() => { setAdding(false) }}
        />
      ) : null}
      {!adding && state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {!adding && state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {!adding && state.status === 'ready' ? (
        <div className={css.catalog}>
          <div className={css.toolbar}>
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
            <Button
              variant="outline"
              size="sm"
              className={css.addButton}
              icon={<IconPlusOutline16 aria-hidden="true" />}
              aria-label={t('addServer')}
              onClick={() => { setAdding(true) }}
            />
          </div>
          <div className={css.catalogHeading}>
            <h3>{t('servers')}</h3>
            <span data-server-count={filteredEntries.length}>{filteredEntries.length}</span>
          </div>
          {state.snapshot.entries.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
          {state.snapshot.entries.length > 0 && filteredEntries.length === 0
            ? <p className={css.status}>{t('emptySearch')}</p>
            : null}
          {filteredEntries.length > 0 ? (
            <ul className={css.cards}>
              {filteredEntries.map((row) => {
                const declarative = row.source === 'declarative'
                const status = row.status
                const statusLabel = status === null ? null : t(STATUS_KEYS[status])
                const isEditing = editing === row.serverName
                const current = isEditing ? readEntry(row.serverName) : undefined
                return (
                  <li className={css.card} key={row.serverName} data-server-name={row.serverName}>
                    <div className={css.cardContent}>
                      <div className={css.cardMain}>
                        <strong className={css.cardTitle} title={row.serverName}>{row.serverName}</strong>
                        {status === 'failed' && row.error !== undefined ? (
                          <p className={css.errorText}>{row.error}</p>
                        ) : null}
                      </div>
                      <span className={css.cardTrailing}>
                        {declarative ? (
                          <span className={css.managedTag}>{t('declarativeTag')}</span>
                        ) : null}
                        {declarative ? (
                          <span className={css.configTag} data-enabled={row.enabled ? 'true' : 'false'}>
                            {t(row.enabled ? 'enabledTag' : 'disabledTag')}
                          </span>
                        ) : null}
                        {statusLabel !== null ? (
                          <span
                            className={css.statusDot}
                            data-status={status}
                            role="img"
                            aria-label={statusLabel}
                            title={statusLabel}
                          />
                        ) : null}
                        <button
                          type="button"
                          className={css.gearButton}
                          aria-label={t('settings')}
                          disabled={declarative}
                          {...(declarative ? { title: t('declarativeTag') } : {})}
                          onClick={() => { setEditing(row.serverName) }}
                        >
                          <IconSettingsOutline16 aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={css.switch}
                          role="switch"
                          aria-checked={row.enabled}
                          aria-label={row.serverName}
                          disabled={declarative || pending === row.serverName}
                          {...(declarative ? { title: t('declarativeTag') } : {})}
                          onClick={() => { toggle(row) }}
                        />
                      </span>
                    </div>
                    {isEditing && current === undefined ? <p className={css.editFailure}>{t('loadFailed')}</p> : null}
                    {isEditing && current !== undefined ? (
                      <div className={css.editArea}>
                        <EditServerForm
                          serverName={row.serverName}
                          entry={current}
                          updateServer={patch => updateServer(row.serverName, patch)}
                          removeServer={() => removeServer(row.serverName)}
                          t={t}
                          onDone={() => {
                            setEditing(null)
                            void refresh()
                          }}
                          onCancel={() => { setEditing(null) }}
                        />
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
