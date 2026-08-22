/**
 * Add-server view: one form over the dsh-mcp-client entry fields, split by
 * transport. Validation runs on every change; a valid draft commits through
 * the injected `addServer` and the tab returns to the roster on acceptance.
 */

import { useMemo, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpLocaleKey } from './locales.ts'
import {
  DEFAULT_RECONNECT_FORM, parseReconnect, ReconnectFields,
  type ReconnectDraft, type ReconnectFormState,
} from './ReconnectFields.tsx'
import css from './AddServerForm.module.css'

/** Commit draft for one new MCP server entry, mirroring the settings schema. */
export type NewServerDraft = { serverName: string } & (
  | { transport: 'stdio'; command: string; args: string[]; env: Record<string, string>; cwd: string }
  | { transport: 'streamable-http'; url: string; headers: Record<string, string> }
) & { toolCallTimeoutMs?: number; reconnect?: ReconnectDraft }

/** Valid serverName, identical to the settings schema and mcp-client. */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/**
 * Split free-form argument text into argv entries.
 * @param text - raw multiline text.
 * @returns trimmed non-empty entries, splitting on lines and commas.
 */
export function splitArgs(text: string): string[] {
  return text.split(/[\n,]+/).map(arg => arg.trim()).filter(arg => arg.length > 0)
}

/**
 * Parse KEY=VALUE (or header-style KEY: VALUE) lines into a record. The
 * earliest separator wins, so values may contain the other separator.
 * Malformed non-empty lines fail the whole parse so a mistyped line cannot
 * silently drop a credential.
 * @param text - raw multiline text.
 * @returns the parsed record, or the locale key of the first malformed line.
 */
export function parseKeyValues(text: string): { values: Record<string, string> } | { error: McpLocaleKey } {
  const values: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    const separators = [line.indexOf('='), line.indexOf(':')].filter(index => index > 0)
    if (separators.length === 0) return { error: 'invalidKeyValue' }
    const split = Math.min(...separators)
    const key = line.slice(0, split).trim()
    if (key.length === 0) return { error: 'invalidKeyValue' }
    values[key] = line.slice(split + 1).trim()
  }
  return { values }
}

/**
 * Validate a composed draft against the serverName pattern, the live roster,
 * and the transport-specific endpoint.
 * @param draft - composed commit draft.
 * @param existingNames - names already configured, for duplicate rejection.
 * @returns the locale key of the first failure, or null when the draft saves.
 */
export function validateDraft(draft: NewServerDraft, existingNames: readonly string[]): McpLocaleKey | null {
  if (!SERVER_NAME_PATTERN.test(draft.serverName)) return 'invalidName'
  if (existingNames.includes(draft.serverName)) return 'duplicateName'
  if (draft.transport === 'stdio' && draft.command.trim().length === 0) return 'missingCommand'
  if (draft.transport === 'streamable-http' && draft.url.trim().length === 0) return 'missingUrl'
  if (draft.toolCallTimeoutMs !== undefined
    && (!Number.isInteger(draft.toolCallTimeoutMs) || draft.toolCallTimeoutMs <= 0)) return 'invalidTimeout'
  return null
}

/** Raw field text this form stages; transport is the only non-text field. */
interface FormState {
  name: string
  transport: 'stdio' | 'streamable-http'
  command: string
  args: string
  env: string
  cwd: string
  url: string
  headers: string
  timeout: string
  reconnect: ReconnectFormState
}

const EMPTY: FormState = {
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  env: '',
  cwd: '',
  url: '',
  headers: '',
  timeout: '',
  reconnect: { ...DEFAULT_RECONNECT_FORM },
}

/** Compose the staged text into a typed draft, or the parse failure that blocks it. */
function draftFrom(state: FormState): { draft: NewServerDraft } | { error: McpLocaleKey } {
  const timeout = state.timeout.trim() === '' ? undefined : Number(state.timeout)
  if (timeout !== undefined && (!Number.isInteger(timeout) || timeout <= 0)) return { error: 'invalidTimeout' }
  const parsedReconnect = parseReconnect(state.reconnect)
  if ('error' in parsedReconnect) return parsedReconnect
  const shared = {
    serverName: state.name.trim(),
    ...(timeout === undefined ? {} : { toolCallTimeoutMs: timeout }),
    ...(parsedReconnect.changed ? { reconnect: parsedReconnect.reconnect } : {}),
  }
  if (state.transport === 'stdio') {
    const env = parseKeyValues(state.env)
    if ('error' in env) return env
    return {
      draft: { ...shared, transport: 'stdio', command: state.command, args: splitArgs(state.args), env: env.values, cwd: state.cwd },
    }
  }
  const headers = parseKeyValues(state.headers)
  if ('error' in headers) return headers
  return { draft: { ...shared, transport: 'streamable-http', url: state.url, headers: headers.values } }
}

/**
 * Compose and validate the staged form in one step.
 * @param state - staged field text.
 * @param existingNames - names already configured, for duplicate rejection.
 * @returns the ready draft or the locale key of the failure blocking it.
 */
export function readyDraft(state: FormState, existingNames: readonly string[]): { draft: NewServerDraft } | { error: McpLocaleKey } {
  const failure = draftFrom(state)
  if ('error' in failure) return failure
  const error = validateDraft(failure.draft, existingNames)
  return error === null ? { draft: failure.draft } : { error }
}

/** Props of {@link AddServerForm}. */
export interface AddServerFormProps {
  /** Names already configured, for duplicate rejection. */
  existingNames: readonly string[]
  /** Commit one validated draft; resolves null on acceptance or an error key. */
  addServer: (draft: NewServerDraft) => Promise<McpLocaleKey | null>
  /** Dictionary binder for this namespace's copy. */
  t: (key: McpLocaleKey) => string
  /** The tab returns to the roster after an accepted save. */
  onDone: () => void
  /** The tab returns to the roster without saving. */
  onCancel: () => void
}

/** Render the add-server form over the settings-managed roster. */
export function AddServerForm({ existingNames, addServer, t, onDone, onCancel }: AddServerFormProps): ReactNode {
  const [state, setState] = useState<FormState>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<McpLocaleKey | null>(null)

  const ready = useMemo(() => readyDraft(state, existingNames), [state, existingNames])
  const blocked = 'error' in ready ? ready.error : null

  const edit = (field: keyof FormState) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    // Captured before the functional update runs: React nulls currentTarget
    // once the dispatch settles, while the updater executes on the next render.
    const value = event.currentTarget.value
    setState(prev => ({ ...prev, [field]: value }))
  }

  const submit = (): void => {
    // The save button is disabled while busy or blocked; this guards a racing
    // click that lands before the next render paints the disabled state.
    /* v8 ignore next -- defensive race guard behind the disabled button */
    if ('error' in ready || busy) return
    setBusy(true)
    setSaveError(null)
    void addServer(ready.draft).then(
      (failure) => {
        if (failure === null) {
          onDone()
          return
        }
        setBusy(false)
        setSaveError(failure)
      },
      () => {
        setBusy(false)
        setSaveError('saveFailed')
      },
    )
  }

  return (
    <div className={css.form}>
      <h3 className={css.title}>{t('addServer')}</h3>
      <div role="radiogroup" aria-label={t('transportLabel')} className={css.transport}>
        {(['stdio', 'streamable-http'] as const).map(value => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={state.transport === value}
            className={css.transportChoice}
            onClick={() => { setState(prev => ({ ...prev, transport: value })) }}
          >
            {value === 'stdio' ? t('transportStdio') : t('transportHttp')}
          </button>
        ))}
      </div>
      <label className={css.field} htmlFor="mcp-server-name">
        <span className={css.fieldLabel}>{t('serverNameLabel')}</span>
        <Input className={css.fieldInput} id="mcp-server-name" value={state.name} onChange={edit('name')} placeholder={t('serverNamePlaceholder')} />
      </label>
      {state.transport === 'stdio' ? (
        <>
          <label className={css.field} htmlFor="mcp-command">
            <span className={css.fieldLabel}>{t('commandLabel')}</span>
            <Input className={css.fieldInput} id="mcp-command" value={state.command} onChange={edit('command')} placeholder={t('commandPlaceholder')} />
          </label>
          <label className={css.field} htmlFor="mcp-args">
            <span className={css.fieldLabel}>{t('argsLabel')}</span>
            <textarea id="mcp-args" className={css.multiline} value={state.args} onChange={edit('args')} placeholder={t('argsPlaceholder')} />
          </label>
          <label className={css.field} htmlFor="mcp-env">
            <span className={css.fieldLabel}>{t('envLabel')}</span>
            <textarea id="mcp-env" className={css.multiline} value={state.env} onChange={edit('env')} placeholder={t('envPlaceholder')} />
          </label>
          <label className={css.field} htmlFor="mcp-cwd">
            <span className={css.fieldLabel}>{t('cwdLabel')}</span>
            <Input className={css.fieldInput} id="mcp-cwd" value={state.cwd} onChange={edit('cwd')} />
          </label>
        </>
      ) : (
        <>
          <label className={css.field} htmlFor="mcp-url">
            <span className={css.fieldLabel}>{t('urlLabel')}</span>
            <Input className={css.fieldInput} id="mcp-url" value={state.url} onChange={edit('url')} placeholder={t('urlPlaceholder')} />
          </label>
          <label className={css.field} htmlFor="mcp-headers">
            <span className={css.fieldLabel}>{t('headersLabel')}</span>
            <textarea id="mcp-headers" className={css.multiline} value={state.headers} onChange={edit('headers')} placeholder={t('headersPlaceholder')} />
          </label>
        </>
      )}
      <label className={css.field} htmlFor="mcp-timeout">
        <span className={css.fieldLabel}>{t('timeoutLabel')}</span>
        <Input className={css.fieldInput} id="mcp-timeout" type="text" inputMode="numeric" value={state.timeout} onChange={edit('timeout')} />
      </label>
      <ReconnectFields
        idPrefix="mcp-add"
        state={state.reconnect}
        setState={(reconnect) => { setState(prev => ({ ...prev, reconnect })) }}
        t={t}
      />
      {blocked !== null ? <p role="alert" className={css.error}>{t(blocked)}</p> : null}
      {saveError !== null && blocked === null ? <p role="alert" className={css.error}>{t(saveError)}</p> : null}
      <div className={css.actions}>
        <Button variant="outline" size="sm" onClick={onCancel}>{t('cancel')}</Button>
        <Button variant="primary" size="sm" onClick={submit} disabled={busy || blocked !== null}>
          {busy ? t('saving') : t('save')}
        </Button>
      </div>
    </div>
  )
}
