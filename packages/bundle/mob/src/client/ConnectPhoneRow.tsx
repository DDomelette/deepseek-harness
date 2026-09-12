/**
 * The Connect-phone row in General settings: the title and the pill button that
 * opens the pairing panel. Opening the panel is what asks the Host for a code,
 * so a deployment without LAN access learns that from the panel's own copy.
 */
import { useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PairingPanel } from './PairingPanel.tsx'
import type { PairingApi } from './pairing-api.ts'
import css from './ConnectPhoneRow.module.css'

/** Injected business face: the join-URL read, the loopback gate, and the pairing routes. */
export interface ConnectPhoneRowInjected {
  /** Ask the Host for the LAN origin a pairing link is built on. */
  joinUrl: () => Promise<RemoteResult<string>>
  /** Whether this page is the loopback surface that may decide a pairing request. */
  canDecide: boolean
  /** The pairing routes' client half. */
  api?: PairingApi | undefined
}

/** Full component props: runtime share + locale seat + injected face. */
export type ConnectPhoneRowComponentProps =
  & PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.mobile'>
  & ConnectPhoneRowInjected

/**
 * Render the Connect-phone row and its pairing panel.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function ConnectPhoneRow({ t, joinUrl, canDecide, api }: ConnectPhoneRowComponentProps) {
  const [open, setOpen] = useState(false)

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
        {open && <PairingPanel t={t} joinUrl={joinUrl} canDecide={canDecide} api={api} />}
      </Modal>
    </div>
  )
}
