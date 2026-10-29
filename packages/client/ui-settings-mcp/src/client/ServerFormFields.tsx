/** Transport, timeout, reconnect, and error fields shared by MCP server forms. */
import clsx from 'clsx'
import type { ChangeEvent, Dispatch, ReactNode, SetStateAction } from 'react'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpLocaleKey } from './locales.ts'
import { ReconnectFields, type ReconnectFormState } from './ReconnectFields.tsx'
import css from './AddServerForm.module.css'

/** Editable fields common to new and existing server entries. */
export interface ServerFormState {
  command: string
  args: string
  env: string
  cwd: string
  url: string
  headers: string
  timeout: string
  reconnect: ReconnectFormState
}

interface ServerFormFieldsProps<State extends ServerFormState> {
  /** Existing server name; omission selects the new-entry ids and secret hints. */
  serverName?: string
  transport: 'stdio' | 'streamable-http'
  state: State
  setState: Dispatch<SetStateAction<State>>
  error: McpLocaleKey | null
  t: (key: McpLocaleKey) => string
}

/**
 * Render editable connection fields without owning draft validation or persistence.
 * @param props - staged fields, edit callback, error, and localized copy.
 * @returns transport-specific fields and shared connection controls.
 */
export function ServerFormFields<State extends ServerFormState>(
  { serverName, transport, state, setState, error, t }: ServerFormFieldsProps<State>,
): ReactNode {
  const fieldId = (field: string): string => `mcp-${field}${serverName === undefined ? '' : `-${serverName}`}`
  const edit = (field: Exclude<keyof ServerFormState, 'reconnect'>) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    const value = event.currentTarget.value
    setState(prev => ({ ...prev, [field]: value }))
  }

  return (
    <>
      {transport === 'stdio' ? (
        <>
          <label className={css.field} htmlFor={fieldId('command')}>
            <span className={css.fieldLabel}>{t('commandLabel')}</span>
            <Input className={clsx(css.fieldInput)} id={fieldId('command')} value={state.command} onChange={edit('command')} placeholder={t('commandPlaceholder')} />
          </label>
          <label className={css.field} htmlFor={fieldId('args')}>
            <span className={css.fieldLabel}>{t('argsLabel')}</span>
            <textarea id={fieldId('args')} className={css.multiline} value={state.args} onChange={edit('args')} placeholder={t('argsPlaceholder')} />
          </label>
          <label className={css.field} htmlFor={fieldId('env')}>
            <span className={css.fieldLabel}>{t('envLabel')}</span>
            <textarea id={fieldId('env')} className={css.multiline} value={state.env} onChange={edit('env')} placeholder={t(serverName === undefined ? 'envPlaceholder' : 'keepSecretHint')} />
          </label>
          <label className={css.field} htmlFor={fieldId('cwd')}>
            <span className={css.fieldLabel}>{t('cwdLabel')}</span>
            <Input className={clsx(css.fieldInput)} id={fieldId('cwd')} value={state.cwd} onChange={edit('cwd')} />
          </label>
        </>
      ) : (
        <>
          <label className={css.field} htmlFor={fieldId('url')}>
            <span className={css.fieldLabel}>{t('urlLabel')}</span>
            <Input className={clsx(css.fieldInput)} id={fieldId('url')} value={state.url} onChange={edit('url')} placeholder={t('urlPlaceholder')} />
          </label>
          <label className={css.field} htmlFor={fieldId('headers')}>
            <span className={css.fieldLabel}>{t('headersLabel')}</span>
            <textarea id={fieldId('headers')} className={css.multiline} value={state.headers} onChange={edit('headers')} placeholder={t(serverName === undefined ? 'headersPlaceholder' : 'keepSecretHint')} />
          </label>
        </>
      )}
      <label className={css.field} htmlFor={fieldId('timeout')}>
        <span className={css.fieldLabel}>{t('timeoutLabel')}</span>
        <Input className={clsx(css.fieldInput)} id={fieldId('timeout')} type="text" inputMode="numeric" value={state.timeout} onChange={edit('timeout')} />
      </label>
      <ReconnectFields
        idPrefix={serverName === undefined ? 'mcp-add' : `mcp-edit-${serverName}`}
        state={state.reconnect}
        setState={(reconnect) => { setState(prev => ({ ...prev, reconnect })) }}
        t={t}
      />
      {error !== null ? <p role="alert" className={css.error}>{t(error)}</p> : null}
    </>
  )
}
