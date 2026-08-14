/**
 * MCP server roster tab: settings-managed rows with hot enablement switches
 * plus read-only cordis.yml-declared rows, over the `mcpServers` Remote
 * snapshot. The status dot reports mount lifecycle only — a settled ('ready')
 * mount is not a proven live connection.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  McpServerListEntry, McpServerSnapshot, McpServerStatus,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button, IconPlusOutline16, IconSearchOutline16, IconSettingsOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpLocaleKey } from './locales.ts'
import css from './McpSettingsTab.module.css'

/** Registration-side face the MCP tab's slot entry injects. */
export interface McpSettingsTabInjected {
  /** Read a current Host roster snapshot (settings-managed and declarative rows). */
  list: () => Promise<McpServerSnapshot>
  /**
   * Write one settings-managed row's enablement through the settings scope.
   * @param serverName - the row's server name.
   * @param enabled - the target enablement.
   * @returns settlement of the queued settings write.
   */
  setEnabled: (serverName: string, enabled: boolean) => Promise<void>
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
export function McpSettingsTab({ list, setEnabled, t }: McpSettingsTabProps): ReactNode {
  const [adding, setAdding] = useState(false)
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'loading' })

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, request])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredEntries = useMemo(
    () => state.status === 'ready'
      ? state.snapshot.entries.filter(entry => matches(entry, normalizedQuery))
      : [],
    [normalizedQuery, state],
  )

  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  // Flip a row, then re-read the roster either way: the Host answers the new
  // mount lifecycle asynchronously, and the roster is the authority even for
  // a refused write. A failed refresh falls back to the retryable error state.
  const toggle = (entry: McpServerListEntry): void => {
    setPending(entry.serverName)
    void setEnabled(entry.serverName, !entry.enabled)
      .then(() => list(), () => list())
      .then(
        (snapshot) => {
          setPending(null)
          setState({ status: 'ready', snapshot })
        },
        () => {
          setPending(null)
          setState({ status: 'error' })
        },
      )
  }

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      {adding ? (
        <div className={css.placeholder}>
          <h3 className={css.placeholderTitle}>{t('addServer')}</h3>
          <button type="button" className={css.backLink} onClick={() => { setAdding(false) }}>
            {t('back')}
          </button>
        </div>
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
              {filteredEntries.map((entry) => {
                const declarative = entry.source === 'declarative'
                const status = entry.status
                const statusLabel = status === null ? null : t(STATUS_KEYS[status])
                return (
                  <li className={css.card} key={entry.serverName} data-server-name={entry.serverName}>
                    <div className={css.cardContent}>
                      <div className={css.cardMain}>
                        <strong className={css.cardTitle} title={entry.serverName}>{entry.serverName}</strong>
                        {status === 'failed' && entry.error !== undefined ? (
                          <p className={css.errorText}>{entry.error}</p>
                        ) : null}
                      </div>
                      <span className={css.cardTrailing}>
                        {declarative ? (
                          <span className={css.managedTag}>{t('declarativeTag')}</span>
                        ) : null}
                        {declarative ? (
                          <span className={css.configTag} data-enabled={entry.enabled ? 'true' : 'false'}>
                            {t(entry.enabled ? 'enabledTag' : 'disabledTag')}
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
                        {/* TODO(ui-settings-mcp-edit): the gear's row edit view
                            lands with the edit task; it ships disabled. */}
                        <button
                          type="button"
                          className={css.gearButton}
                          aria-label={t('settings')}
                          disabled
                          {...(declarative ? { title: t('declarativeTag') } : {})}
                        >
                          <IconSettingsOutline16 aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={css.switch}
                          role="switch"
                          aria-checked={entry.enabled}
                          aria-label={entry.serverName}
                          disabled={declarative || pending === entry.serverName}
                          {...(declarative ? { title: t('declarativeTag') } : {})}
                          onClick={() => { toggle(entry) }}
                        />
                      </span>
                    </div>
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
