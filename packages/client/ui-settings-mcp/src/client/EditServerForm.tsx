/**
 * Inline edit view for one settings-managed server row. Non-secret fields
 * prefill from the redacted entry; the env/headers textareas start blank and
 * a blank submission leaves the stored secrets untouched, because the
 * controller writes only the fields the user changed as per-field path ops.
 */

import { useMemo, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpServerSettingsEntry } from './mcp-tab-controller.ts'
import { parseKeyValues, splitArgs, validateDraft, type NewServerDraft } from './AddServerForm.tsx'
import type { McpLocaleKey } from './locales.ts'
import {
  DEFAULT_RECONNECT_FORM, DEFAULT_RECONNECT_POLICY, parseReconnect, ReconnectFields,
  type ReconnectDraft, type ReconnectFormState,
} from './ReconnectFields.tsx'
import css from './AddServerForm.module.css'

/** Incremental update for one server entry: only the fields the user changed. */
export type ServerPatch = {
  command?: string
  args?: string[]
  cwd?: string
  url?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  toolCallTimeoutMs?: number
  reconnect?: ReconnectDraft
  /**
   * Cleared timeout fields reset to the schema/composition default instead of
   * being written: a cleared number has no JSON value that means "absent", so
   * the controller emits an `unset` path op for it.
   */
  unsetTimeout?: true
}

/** Raw field text this form stages. */
export interface FormState {
  command: string
  args: string
  env: string
  cwd: string
  url: string
  headers: string
  timeout: string
  reconnect: ReconnectFormState
}

function sameReconnect(left: ReconnectDraft, right: ReconnectDraft): boolean {
  return left.enabled === right.enabled
    && left.initialDelayMs === right.initialDelayMs
    && left.maxDelayMs === right.maxDelayMs
    && left.maxAttempts === right.maxAttempts
}

/** Prefill the editable text from the redacted entry; secrets always start blank. */
function stateFrom(entry: McpServerSettingsEntry): FormState {
  return {
    command: entry.command ?? '',
    args: (entry.args ?? []).join('\n'),
    env: '',
    cwd: entry.cwd ?? '',
    url: entry.url ?? '',
    headers: '',
    timeout: entry.toolCallTimeoutMs === undefined ? '' : String(entry.toolCallTimeoutMs),
    reconnect: entry.reconnect === undefined
      ? { ...DEFAULT_RECONNECT_FORM }
      : {
        enabled: entry.reconnect.enabled,
        initialDelayMs: String(entry.reconnect.initialDelayMs),
        maxDelayMs: String(entry.reconnect.maxDelayMs),
        maxAttempts: String(entry.reconnect.maxAttempts),
      },
  }
}

/**
 * Compose and validate the incremental patch in one step. Validation runs
 * against the EFFECTIVE entry (prefill plus edits); the patch then names only
 * the fields that moved, so blank secret fields stay out of it.
 * @param entry - current redacted entry the edits apply over.
 * @param serverName - the row's name, for the effective-entry validator.
 * @param state - staged field text.
 * @returns the incremental patch or the locale key of the failure blocking it.
 */
export function editPatch(
  entry: McpServerSettingsEntry,
  serverName: string,
  state: FormState,
): { patch: ServerPatch } | { error: McpLocaleKey } {
  const timeout = state.timeout.trim() === '' ? undefined : Number(state.timeout)
  if (timeout !== undefined && (!Number.isInteger(timeout) || timeout <= 0)) return { error: 'invalidTimeout' }
  const env = state.env.trim() === '' ? undefined : parseKeyValues(state.env)
  if (env !== undefined && 'error' in env) return { error: env.error }
  const headers = state.headers.trim() === '' ? undefined : parseKeyValues(state.headers)
  if (headers !== undefined && 'error' in headers) return { error: headers.error }
  const parsedReconnect = parseReconnect(state.reconnect)
  if ('error' in parsedReconnect) return parsedReconnect

  const args = splitArgs(state.args)
  const shared = { serverName, ...(timeout === undefined ? {} : { toolCallTimeoutMs: timeout }) }
  const composed: NewServerDraft = entry.transport === 'stdio'
    ? { ...shared, transport: 'stdio', command: state.command, args, env: env === undefined ? {} : env.values, cwd: state.cwd }
    : { ...shared, transport: 'streamable-http', url: state.url, headers: headers === undefined ? {} : headers.values }
  const error = validateDraft(composed, [])
  if (error !== null) return { error }

  const patch: ServerPatch = {}
  if (state.command !== (entry.command ?? '')) patch.command = state.command
  if (JSON.stringify(args) !== JSON.stringify(entry.args ?? [])) patch.args = args
  if (state.cwd !== (entry.cwd ?? '')) patch.cwd = state.cwd
  if (state.url !== (entry.url ?? '')) patch.url = state.url
  if (timeout !== undefined && timeout !== entry.toolCallTimeoutMs) patch.toolCallTimeoutMs = timeout
  if (timeout === undefined && entry.toolCallTimeoutMs !== undefined) patch.unsetTimeout = true
  if (env !== undefined) patch.env = env.values
  if (headers !== undefined) patch.headers = headers.values
  const currentReconnect = entry.reconnect ?? DEFAULT_RECONNECT_POLICY
  if (!sameReconnect(parsedReconnect.reconnect, currentReconnect)) {
    patch.reconnect = parsedReconnect.reconnect
  }
  return { patch }
}

/** Props of {@link EditServerForm}. */
export interface EditServerFormProps {
  /** Server name of the row under edit; displayed, never renamed. */
  serverName: string
  /** Current redacted entry values the form prefills. */
  entry: McpServerSettingsEntry
  /** Commit one incremental patch; resolves null on acceptance or an error key. */
  updateServer: (patch: ServerPatch) => Promise<McpLocaleKey | null>
  /** Remove the server after confirmation; resolves null on acceptance or an error key. */
  removeServer: () => Promise<McpLocaleKey | null>
  /** Dictionary binder for this namespace's copy. */
  t: (key: McpLocaleKey) => string
  /** The tab closes the view and re-reads the roster after acceptance or removal. */
  onDone: () => void
  /** The tab closes the view without saving. */
  onCancel: () => void
}

/** Render the inline editor for one settings-managed server row. */
export function EditServerForm({ serverName, entry, updateServer, removeServer, t, onDone, onCancel }: EditServerFormProps): ReactNode {
  const [state, setState] = useState<FormState>(() => stateFrom(entry))
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<McpLocaleKey | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [removeBusy, setRemoveBusy] = useState(false)

  const ready = useMemo(() => editPatch(entry, serverName, state), [entry, serverName, state])
  const blocked = 'error' in ready ? ready.error : null

  const edit = (field: keyof FormState) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    // Captured before the functional update runs: React nulls currentTarget
    // once the dispatch settles, while the updater executes on the next render.
    const value = event.currentTarget.value
    setState(prev => ({ ...prev, [field]: value }))
  }

  const save = (): void => {
    // The save button is disabled while busy or blocked; this guards a racing
    // click that lands before the next render paints the disabled state.
    /* v8 ignore next -- defensive race guard behind the disabled button */
    if ('error' in ready || busy) return
    setBusy(true)
    setSaveError(null)
    void updateServer(ready.patch).then(
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

  const remove = (): void => {
    // The confirm button is disabled while the removal is in flight; this
    // guards a racing click that lands before the next render.
    /* v8 ignore next -- defensive race guard behind the disabled button */
    if (removeBusy) return
    setRemoveBusy(true)
    void removeServer().then(
      (failure) => {
        if (failure === null) {
          onDone()
          return
        }
        setRemoveBusy(false)
        setSaveError(failure)
      },
      () => {
        setRemoveBusy(false)
        setSaveError('saveFailed')
      },
    )
  }

  return (
    <div className={css.form}>
      <h3 className={css.title}>{serverName}</h3>
      {entry.transport === 'stdio' ? (
        <>
          <label className={css.field} htmlFor={`mcp-command-${serverName}`}>
            <span className={css.fieldLabel}>{t('commandLabel')}</span>
            <Input id={`mcp-command-${serverName}`} value={state.command} onChange={edit('command')} placeholder={t('commandPlaceholder')} />
          </label>
          <label className={css.field} htmlFor={`mcp-args-${serverName}`}>
            <span className={css.fieldLabel}>{t('argsLabel')}</span>
            <textarea id={`mcp-args-${serverName}`} className={css.multiline} value={state.args} onChange={edit('args')} placeholder={t('argsPlaceholder')} />
          </label>
          <label className={css.field} htmlFor={`mcp-env-${serverName}`}>
            <span className={css.fieldLabel}>{t('envLabel')}</span>
            <textarea id={`mcp-env-${serverName}`} className={css.multiline} value={state.env} onChange={edit('env')} placeholder={t('keepSecretHint')} />
          </label>
          <label className={css.field} htmlFor={`mcp-cwd-${serverName}`}>
            <span className={css.fieldLabel}>{t('cwdLabel')}</span>
            <Input id={`mcp-cwd-${serverName}`} value={state.cwd} onChange={edit('cwd')} />
          </label>
        </>
      ) : (
        <>
          <label className={css.field} htmlFor={`mcp-url-${serverName}`}>
            <span className={css.fieldLabel}>{t('urlLabel')}</span>
            <Input id={`mcp-url-${serverName}`} value={state.url} onChange={edit('url')} placeholder={t('urlPlaceholder')} />
          </label>
          <label className={css.field} htmlFor={`mcp-headers-${serverName}`}>
            <span className={css.fieldLabel}>{t('headersLabel')}</span>
            <textarea id={`mcp-headers-${serverName}`} className={css.multiline} value={state.headers} onChange={edit('headers')} placeholder={t('keepSecretHint')} />
          </label>
        </>
      )}
      <label className={css.field} htmlFor={`mcp-timeout-${serverName}`}>
        <span className={css.fieldLabel}>{t('timeoutLabel')}</span>
        <Input id={`mcp-timeout-${serverName}`} type="text" inputMode="numeric" value={state.timeout} onChange={edit('timeout')} />
      </label>
      <ReconnectFields
        idPrefix={`mcp-edit-${serverName}`}
        state={state.reconnect}
        setState={(reconnect) => { setState(prev => ({ ...prev, reconnect })) }}
        t={t}
      />
      {blocked !== null ? <p role="alert" className={css.error}>{t(blocked)}</p> : null}
      {saveError !== null && blocked === null ? <p role="alert" className={css.error}>{t(saveError)}</p> : null}
      <div className={css.actions}>
        <Button variant="primary" size="sm" onClick={save} disabled={busy || blocked !== null}>
          {busy ? t('saving') : t('save')}
        </Button>
        {!confirming ? (
          <Button variant="outline" size="sm" onClick={onCancel}>{t('cancel')}</Button>
        ) : null}
        {confirming ? (
          <>
            <Button variant="primary" size="sm" onClick={remove} disabled={removeBusy}>{t('deleteConfirm')}</Button>
            <Button variant="outline" size="sm" onClick={() => { setConfirming(false) }}>{t('cancel')}</Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => { setConfirming(true) }}>{t('delete')}</Button>
        )}
      </div>
    </div>
  )
}
