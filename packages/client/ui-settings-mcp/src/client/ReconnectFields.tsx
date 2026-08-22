/** Shared automatic-reconnect fields for the MCP add and edit forms. */

import type { ChangeEvent, ReactNode } from 'react'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpLocaleKey } from './locales.ts'
import css from './AddServerForm.module.css'

/** Complete reconnect policy persisted for one settings-managed server. */
export interface ReconnectDraft {
  /** Whether a lost connection starts a reconnect loop. */
  enabled: boolean
  /** Delay before the first reconnect attempt, in milliseconds. */
  initialDelayMs: number
  /** Maximum backoff delay between reconnect attempts, in milliseconds. */
  maxDelayMs: number
  /** Maximum reconnect attempts before the loop stops. */
  maxAttempts: number
}

/** Text staged by the shared reconnect controls. */
export interface ReconnectFormState {
  /** Whether automatic reconnect is selected. */
  enabled: boolean
  /** Staged initial delay in decimal milliseconds. */
  initialDelayMs: string
  /** Staged maximum delay in decimal milliseconds. */
  maxDelayMs: string
  /** Staged maximum attempt count. */
  maxAttempts: string
}

/** Resolved reconnect defaults mirrored from dsh-mcp-client and guarded by a parity test. */
export const DEFAULT_RECONNECT_POLICY: Readonly<ReconnectDraft> = Object.freeze({
  enabled: true,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  maxAttempts: 10,
})

/** Browser timer ceiling mirrored from dsh-timeout and guarded by a parity test. */
export const MAX_RECONNECT_DELAY_MS = 2_147_483_647

/** Text form of {@link DEFAULT_RECONNECT_POLICY}. */
export const DEFAULT_RECONNECT_FORM: Readonly<ReconnectFormState> = Object.freeze({
  enabled: DEFAULT_RECONNECT_POLICY.enabled,
  initialDelayMs: String(DEFAULT_RECONNECT_POLICY.initialDelayMs),
  maxDelayMs: String(DEFAULT_RECONNECT_POLICY.maxDelayMs),
  maxAttempts: String(DEFAULT_RECONNECT_POLICY.maxAttempts),
})

/**
 * Parse and validate staged reconnect fields.
 * @param state - staged checkbox and numeric text.
 * @returns the complete policy and whether it differs from the defaults, or an error key.
 */
export function parseReconnect(
  state: ReconnectFormState,
): { reconnect: ReconnectDraft; changed: boolean } | { error: McpLocaleKey } {
  const initialDelayMs = Number(state.initialDelayMs)
  const maxDelayMs = Number(state.maxDelayMs)
  const maxAttempts = Number(state.maxAttempts)
  if (!Number.isInteger(initialDelayMs) || initialDelayMs < 1 || initialDelayMs > MAX_RECONNECT_DELAY_MS
    || !Number.isInteger(maxDelayMs) || maxDelayMs < 1 || maxDelayMs > MAX_RECONNECT_DELAY_MS
    || initialDelayMs > maxDelayMs
    || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    return { error: 'invalidReconnect' }
  }
  const reconnect = { enabled: state.enabled, initialDelayMs, maxDelayMs, maxAttempts }
  return {
    reconnect,
    changed: !state.enabled
      || state.initialDelayMs !== DEFAULT_RECONNECT_FORM.initialDelayMs
      || state.maxDelayMs !== DEFAULT_RECONNECT_FORM.maxDelayMs
      || state.maxAttempts !== DEFAULT_RECONNECT_FORM.maxAttempts,
  }
}

/** Props of {@link ReconnectFields}. */
export interface ReconnectFieldsProps {
  /** Unique id prefix for labels when an editor can coexist with another form. */
  idPrefix: string
  /** Staged reconnect values. */
  state: ReconnectFormState
  /** Replace the staged reconnect values. */
  setState: (next: ReconnectFormState) => void
  /** Dictionary binder for this namespace's copy. */
  t: (key: McpLocaleKey) => string
}

/**
 * Render the shared reconnect policy controls.
 * @param props - staged values, replacement callback, and localized copy.
 * @returns the reconnect field group.
 */
export function ReconnectFields({ idPrefix, state, setState, t }: ReconnectFieldsProps): ReactNode {
  const edit = (field: 'initialDelayMs' | 'maxDelayMs' | 'maxAttempts') =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      setState({ ...state, [field]: event.currentTarget.value })
    }
  return (
    <fieldset className={css.reconnect}>
      <legend className={css.fieldLabel}>{t('reconnectTitle')}</legend>
      <label className={css.checkboxField} htmlFor={`${idPrefix}-reconnect-enabled`}>
        <input
          id={`${idPrefix}-reconnect-enabled`}
          type="checkbox"
          checked={state.enabled}
          onChange={(event) => { setState({ ...state, enabled: event.currentTarget.checked }) }}
        />
        <span>{t('reconnectEnabledLabel')}</span>
      </label>
      <div className={css.reconnectGrid}>
        <label className={css.field} htmlFor={`${idPrefix}-reconnect-initial`}>
          <span className={css.fieldLabel}>{t('reconnectInitialDelayLabel')}</span>
          <Input className={css.fieldInput} id={`${idPrefix}-reconnect-initial`} type="text" inputMode="numeric" value={state.initialDelayMs} onChange={edit('initialDelayMs')} />
        </label>
        <label className={css.field} htmlFor={`${idPrefix}-reconnect-max-delay`}>
          <span className={css.fieldLabel}>{t('reconnectMaxDelayLabel')}</span>
          <Input className={css.fieldInput} id={`${idPrefix}-reconnect-max-delay`} type="text" inputMode="numeric" value={state.maxDelayMs} onChange={edit('maxDelayMs')} />
        </label>
        <label className={css.field} htmlFor={`${idPrefix}-reconnect-attempts`}>
          <span className={css.fieldLabel}>{t('reconnectMaxAttemptsLabel')}</span>
          <Input className={css.fieldInput} id={`${idPrefix}-reconnect-attempts`} type="text" inputMode="numeric" value={state.maxAttempts} onChange={edit('maxAttempts')} />
        </label>
      </div>
    </fieldset>
  )
}
