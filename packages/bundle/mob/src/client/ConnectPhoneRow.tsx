/**
 * The Connect-phone row in General settings: title plus a pill button that
 * opens the QR dialog. Opening the dialog asks the Host for the token-bearing
 * LAN join URL through the injected face and renders it as a QR code.
 */
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import css from './ConnectPhoneRow.module.css'

/** Injected business face: the join-URL read (t rides the standard locale seat). */
export interface ConnectPhoneRowInjected {
  /** Ask the Host for the token-bearing LAN join URL. */
  joinUrl: () => Promise<RemoteResult<string>>
}

/** Full component props: runtime share + locale seat + injected face. */
export type ConnectPhoneRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings.mobile'> & ConnectPhoneRowInjected

type JoinState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly url: string; readonly qr: string }
  | { readonly status: 'unavailable' }
  | { readonly status: 'failed' }

/**
 * Render the Connect-phone row and its QR dialog.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function ConnectPhoneRow({ t, joinUrl }: ConnectPhoneRowComponentProps) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<JoinState>({ status: 'loading' })

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setState({ status: 'loading' })
    void joinUrl()
      .then(async (result): Promise<JoinState> => {
        if (!result.ok) {
          return { status: result.error.code === 'mob/loopback-only' ? 'unavailable' : 'failed' }
        }
        return { status: 'ready', url: result.value, qr: await QRCode.toDataURL(result.value, { margin: 1 }) }
      })
      // A carrier-level rejection or a QR render failure must not strand the
      // dialog on the loading copy.
      .catch((): JoinState => ({ status: 'failed' }))
      .then((next) => { if (!cancelled) setState(next) })
    return () => { cancelled = true }
  }, [open, joinUrl])

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('connectPhone')}</div>
      </div>
      <button type="button" className={css.action} onClick={() => { setOpen(true) }}>
        {t('showQr')}
      </button>
      <Modal
        open={open}
        onClose={() => { setOpen(false) }}
        title={t('dialog.title')}
        closeLabel={t('close')}
        description={t('dialog.description')}
      >
        {state.status === 'loading' && <p className={css.status}>{t('dialog.loading')}</p>}
        {state.status === 'unavailable' && <p className={css.status}>{t('dialog.unavailable')}</p>}
        {state.status === 'failed' && <p className={css.status}>{t('dialog.loadFailed')}</p>}
        {state.status === 'ready' && (
          <div className={css.qrBox}>
            <img className={css.qr} src={state.qr} alt={t('dialog.title')} />
            <input
              className={css.url}
              value={state.url}
              readOnly
              aria-label={t('dialog.urlLabel')}
              onFocus={(event) => { event.currentTarget.select() }}
            />
          </div>
        )}
      </Modal>
    </div>
  )
}
