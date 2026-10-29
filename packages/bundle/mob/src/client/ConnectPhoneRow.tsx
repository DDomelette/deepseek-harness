/**
 * The Connect-phone row in General settings: the title and the pill button that
 * opens the pairing panel. The panel verifies operator access before offering
 * code generation and explains which phone address the deployment needs.
 */
import { useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PairingPanel } from './PairingPanel.tsx'
import type { PairingApi } from './pairing-api.ts'
import css from './ConnectPhoneRow.module.css'

/* v8 ignore next -- the css module always defines the class; the fallback satisfies the index-signature type. */
const dialogClass = css.dialog ?? ''
/* v8 ignore next -- the css module always defines the class; the fallback satisfies the index-signature type. */
const contentFitClass = css.contentFit ?? ''
/* v8 ignore next -- the css module always defines the class; the fallback satisfies the index-signature type. */
const scrollClass = css.scroll ?? ''

/** Injected business face: the join-URL read and the operator-authenticated pairing routes. */
export interface ConnectPhoneRowInjected {
  /** Ask the Host for the LAN origin a pairing link is built on. */
  joinUrl: () => Promise<RemoteResult<string>>
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
export function ConnectPhoneRow({ t, joinUrl, api }: ConnectPhoneRowComponentProps) {
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
        className={dialogClass}
        contentClassName={`${contentFitClass} ${scrollClass}`}
      >
        {open && <PairingPanel t={t} joinUrl={joinUrl} api={api} />}
      </Modal>
    </div>
  )
}
