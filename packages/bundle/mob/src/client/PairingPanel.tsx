/**
 * The pairing panel behind the Connect-phone row: it opens a request, shows the
 * phone's code and QR with the time left, decides the requests waiting for an
 * answer, and lists or revokes the devices already approved. Every operation
 * goes through the `/pair*` routes, so this page must be the computer itself.
 */
import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode/lib/browser.js'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './PairingPanel.module.css'
import {
  createPairingApi, deviceLabelFrom, pairingUrlOf,
  type PairedDeviceView, type PairingApi, type PendingPairingView,
} from './pairing-api.ts'
import type { MobileSettingsKey } from './locales.ts'

/** How often the panel re-reads the waiting requests while a code is open. */
const REQUEST_POLL_MILLISECONDS = 2_000
/** How often the countdown re-renders. */
const COUNTDOWN_TICK_MILLISECONDS = 1_000

/** Injected face: the LAN join URL, whether this page may decide, and the routes' client half. */
export interface PairingPanelInjected {
  /** This Host's token-bearing LAN join URL, from the `mob.joinUrl` Remote method. */
  joinUrl: () => Promise<RemoteResult<string>>
  /** Whether this page is the loopback surface the routes accept a decision from. */
  canDecide: boolean
  /** The pairing routes' client half. */
  api?: PairingApi | undefined
}

/** Props of the panel: the settings dictionary plus the injected pairing face. */
export type PairingPanelProps = PropsLocale<'settings.mobile'> & PairingPanelInjected

/** One open code, with the URL and QR the phone scans. */
interface OpenSession {
  readonly code: string
  readonly expiresAt: number
  readonly url: string
  readonly qr: string
}

/** Copy for the notice line. */
const NOTICE_KEY = {
  expired: 'panel.expired',
  failed: 'panel.failed',
  lan: 'dialog.unavailable',
} as const satisfies Record<string, MobileSettingsKey>

type Notice = keyof typeof NOTICE_KEY

/** Absolute `MM-DD HH:mm` stamp; the panel shows when a device was added and used. */
function formatStamp(milliseconds: number): string {
  const at = new Date(milliseconds)
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * Render the pairing panel.
 * @param props - the settings dictionary and the injected pairing face.
 * @returns the panel element tree.
 */
export function PairingPanel({ t, joinUrl, canDecide, api = createPairingApi() }: PairingPanelProps) {
  const [session, setSession] = useState<OpenSession | undefined>(undefined)
  const [requests, setRequests] = useState<readonly PendingPairingView[]>([])
  const [labels, setLabels] = useState<Readonly<Record<string, string>>>({})
  const [devices, setDevices] = useState<readonly PairedDeviceView[]>([])
  const [notice, setNotice] = useState<Notice | undefined>(undefined)
  const [now, setNow] = useState(() => Date.now())

  const remaining = useMemo(
    () => session === undefined ? 0 : Math.max(0, Math.ceil((session.expiresAt - now) / 1_000)),
    [session, now],
  )

  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, COUNTDOWN_TICK_MILLISECONDS)
    return () => { clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (session !== undefined && remaining === 0) {
      setSession(undefined)
      setRequests([])
      setNotice('expired')
    }
  }, [session, remaining])

  useEffect(() => {
    if (!canDecide) return
    let cancelled = false
    void api.devices().then((answer) => {
      if (cancelled || !answer.ok) return
      setDevices(answer.value)
    })
    return () => { cancelled = true }
  }, [api, canDecide])

  useEffect(() => {
    if (!canDecide) return
    let cancelled = false
    const read = async (): Promise<void> => {
      const answer = await api.requests()
      if (cancelled || !answer.ok) return
      setRequests(answer.value)
    }
    void read()
    const timer = setInterval(() => { void read() }, REQUEST_POLL_MILLISECONDS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [api, canDecide])

  if (!canDecide) return <p className={css.status}>{t('panel.lanOnly')}</p>

  const open = async (): Promise<void> => {
    const answer = await api.open()
    if (!answer.ok) {
      setNotice(answer.reason === 'forbidden' ? 'lan' : 'failed')
      return
    }
    const joined = await joinUrl()
    if (!joined.ok) {
      setNotice(joined.error.code === 'mob/loopback-only' ? 'lan' : 'failed')
      return
    }
    const url = pairingUrlOf(joined.value, answer.value.code)
    const qr = await QRCode.toDataURL(url, { margin: 1 })
    setSession({ code: answer.value.code, expiresAt: answer.value.expiresAt, url, qr })
    setNotice(undefined)
  }

  const decide = async (request: PendingPairingView, allowed: boolean): Promise<void> => {
    const label = labels[request.code] ?? deviceLabelFrom(request.userAgent) ?? t('panel.deviceFallback')
    const answer = await api.decide(request.code, label, allowed)
    if (!answer.ok) {
      setNotice('failed')
      return
    }
    const listed = await api.requests()
    if (listed.ok) setRequests(listed.value)
    const paired = await api.devices()
    if (paired.ok) setDevices(paired.value)
  }

  const revoke = async (deviceId: string): Promise<void> => {
    const answer = await api.revoke(deviceId)
    if (!answer.ok) {
      setNotice('failed')
      return
    }
    setDevices(current => current.filter(device => device.id !== deviceId))
  }

  return (
    <div className={css.panel}>
      {session === undefined
        ? (
          <button type="button" className={css.action} onClick={() => { void open() }}>
            {t('panel.generate')}
          </button>
        )
        : (
          <div className={css.session}>
            <img className={css.qr} src={session.qr} alt={t('dialog.title')} />
            <div className={css.code}>{session.code}</div>
            <p className={css.status}>{t('panel.expiresIn', { seconds: remaining })}</p>
            <input className={css.url} value={session.url} readOnly aria-label={t('dialog.urlLabel')} />
            <p className={css.status}>{t('panel.codeHint')}</p>
          </div>
        )}

      {notice !== undefined && <p className={css.status} role="alert">{t(NOTICE_KEY[notice])}</p>}

      <section className={css.section}>
        <h3 className={css.heading}>{t('panel.requests')}</h3>
        {requests.length === 0
          ? <p className={css.status}>{t('panel.noRequests')}</p>
          : (
            <ul className={css.list}>
              {requests.map(request => (
                <li key={request.code} className={css.item}>
                  <label className={css.field}>
                    {t('panel.deviceLabel')}
                    <input
                      className={css.input}
                      value={labels[request.code] ?? deviceLabelFrom(request.userAgent) ?? ''}
                      placeholder={t('panel.deviceFallback')}
                      onChange={(event) => {
                        const value = event.currentTarget.value
                        setLabels(current => ({ ...current, [request.code]: value }))
                      }}
                    />
                  </label>
                  <div className={css.actions}>
                    <button type="button" className={css.action} onClick={() => { void decide(request, true) }}>
                      {t('panel.allow')}
                    </button>
                    <button type="button" className={css.action} onClick={() => { void decide(request, false) }}>
                      {t('panel.deny')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className={css.section}>
        <h3 className={css.heading}>{t('panel.devices')}</h3>
        {devices.length === 0
          ? <p className={css.status}>{t('panel.noDevices')}</p>
          : (
            <ul className={css.list}>
              {devices.map(device => (
                <li key={device.id} className={css.item}>
                  <div className={css.device}>
                    <div className={css.deviceLabel}>{device.label}</div>
                    <div className={css.status}>
                      {t('panel.registered', { time: formatStamp(device.registeredAt) })}
                      {' · '}
                      {t('panel.lastSeen', { time: formatStamp(device.lastSeenAt) })}
                    </div>
                  </div>
                  <button type="button" className={css.action} onClick={() => { void revoke(device.id) }}>
                    {t('panel.revoke')}
                  </button>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  )
}
