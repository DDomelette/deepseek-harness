/**
 * The pairing panel behind the Connect-phone row: it opens a request, shows the
 * phone's code and QR with the time left, decides the requests waiting for an
 * answer, and lists the devices already approved. Revoking moves a device to
 * the recycle bin, where it stays restorable until the operator purges it.
 * Every operation goes through the `/pair*` routes, so this page must be the
 * computer itself.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode/lib/browser.js'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, IconEditOutline16, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
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
/** How long the copy button keeps its confirmation before reverting. */
const COPIED_FEEDBACK_MILLISECONDS = 2_000
/** Day counts the lifetime controls offer as one-click presets. */
const LIFETIME_PRESETS = [1, 7, 30, 90] as const
/** Milliseconds in one day, for the remaining-days column. */
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
/** Legal device lifetime in days, matching the route's acceptance rule. */
const MIN_LIFETIME_DAYS = 1
const MAX_LIFETIME_DAYS = 365
/** Menu id of the lifetime menu's pinned custom entry. */
const CUSTOM_LIFETIME_ID = 'custom'
/** Longest device label the rename input accepts, matching the route's bound. */
const MAX_LABEL_LENGTH = 64

/** Injected face: the LAN join URL, whether this page may decide, and the routes' client half. */
export interface PairingPanelInjected {
  /** This Host's LAN origin, from the `mob.joinUrl` Remote method; the pairing link is built on it. */
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
  readonly openedAt: number
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
  const [customDays, setCustomDays] = useState<Readonly<Record<string, string>>>({})
  const [copied, setCopied] = useState(false)
  const [confirmPurge, setConfirmPurge] = useState<string | undefined>(undefined)
  /** Device whose name is being edited inline; the draft is the input's value. */
  const [renaming, setRenaming] = useState<string | undefined>(undefined)
  const [renameDraft, setRenameDraft] = useState('')
  /** Device whose lifetime menu or custom-days row is open. */
  const [lifetimeMenu, setLifetimeMenu] = useState<string | undefined>(undefined)
  const [customOpen, setCustomOpen] = useState<string | undefined>(undefined)
  const urlField = useRef<HTMLInputElement | null>(null)

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
    if (!copied) return
    const timer = setTimeout(() => { setCopied(false) }, COPIED_FEEDBACK_MILLISECONDS)
    return () => { clearTimeout(timer) }
  }, [copied])

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
    setSession({ code: answer.value.code, openedAt: Date.now(), expiresAt: answer.value.expiresAt, url, qr })
    setNotice(undefined)
  }

  /** Copy the pairing link; without the Clipboard API the selected field still gives the operator Ctrl+C. */
  const copy = async (): Promise<void> => {
    /* v8 ignore next -- the copy button only renders inside an open session. */
    if (session === undefined) return
    try {
      await navigator.clipboard.writeText(session.url)
    } catch {
      // The clipboard write is the only statement that can throw here.
      urlField.current?.select()
    }
    setCopied(true)
  }

  /** Re-read the device list after a mutation, keeping the current list when the read fails. */
  const reloadDevices = async (): Promise<void> => {
    const listed = await api.devices()
    if (listed.ok) setDevices(listed.value)
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
    await reloadDevices()
  }

  /** Run one device mutation and refresh the list, or surface the failure. */
  const mutateDevice = async (act: () => Promise<{ readonly ok: boolean }>): Promise<void> => {
    const answer = await act()
    if (!answer.ok) {
      setNotice('failed')
      return
    }
    await reloadDevices()
  }

  /** Lifetime cell of one device row: its window, `expired`, or unknown for a legacy entry. */
  const lifetimeOf = (device: PairedDeviceView): string => {
    if (device.lifetimeDays === undefined || device.expiresAt === undefined) return t('panel.lifetimeUnknown')
    if (device.expiresAt <= now) return t('panel.lifetimeExpired')
    const remaining = Math.max(0, Math.ceil((device.expiresAt - now) / DAY_MILLISECONDS))
    return t('panel.lifetimeWindow', { days: device.lifetimeDays, remaining })
  }

  /** The day count typed for one device, when it is inside the legal range. */
  const customDaysOf = (deviceId: string): number | undefined => {
    const entered = customDays[deviceId]
    if (entered === undefined || entered.trim() === '') return undefined
    const days = Number(entered)
    return Number.isSafeInteger(days) && days >= MIN_LIFETIME_DAYS && days <= MAX_LIFETIME_DAYS ? days : undefined
  }

  const setLifetime = async (deviceId: string, days: number): Promise<void> => {
    await mutateDevice(() => api.setLifetime(deviceId, days))
  }

  /** Commit the rename draft for one device; an empty or unchanged draft just closes the input. */
  const commitRename = async (device: PairedDeviceView): Promise<void> => {
    const label = renameDraft.trim()
    setRenaming(undefined)
    if (label === '' || label === device.label) return
    await mutateDevice(() => api.rename(device.id, label))
  }

  const purge = async (deviceId: string): Promise<void> => {
    setConfirmPurge(undefined)
    await mutateDevice(() => api.purge(deviceId))
  }

  const active = devices.filter(device => device.revokedAt === undefined)
  const binned = devices.filter((device): device is PairedDeviceView & { readonly revokedAt: number } =>
    device.revokedAt !== undefined)
  const sessionTotal = session === undefined ? 1 : Math.max(1, session.expiresAt - session.openedAt)

  return (
    <div className={css.panel}>
      {session === undefined
        ? (
          <button type="button" className={css.primary} onClick={() => { void open() }}>
            {t('panel.generate')}
          </button>
        )
        : (
          <div className={css.sessionCard}>
            <div className={css.qrBox}>
              <img className={css.qr} src={session.qr} alt={t('dialog.title')} />
            </div>
            <div className={css.code}>{session.code}</div>
            <div className={css.countRow}>
              <span className={css.status}>{t('panel.expiresIn', { seconds: remaining })}</span>
              <div className={css.countTrack}>
                <div
                  className={css.countFill}
                  style={{ width: `${Math.min(100, Math.max(0, (remaining * 1_000) / sessionTotal * 100))}%` }}
                />
              </div>
            </div>
            <div className={css.urlRow}>
              <input ref={urlField} className={css.url} value={session.url} readOnly aria-label={t('dialog.urlLabel')} />
              <button type="button" className={css.action} onClick={() => { void copy() }}>
                {copied ? t('panel.copied') : t('panel.copy')}
              </button>
            </div>
            <p className={css.hint}>{t('panel.codeHint')}</p>
          </div>
        )}

      {notice !== undefined && <p className={css.notice} role="alert">{t(NOTICE_KEY[notice])}</p>}

      <section className={css.section}>
        <div className={css.headingRow}>
          <h3 className={css.heading}>{t('panel.requests')}</h3>
          {requests.length > 0 && <span className={css.badge}>{requests.length}</span>}
        </div>
        {requests.length === 0
          ? <p className={css.status}>{t('panel.noRequests')}</p>
          : (
            <ul className={css.list}>
              {requests.map(request => (
                <li key={request.code} className={css.card}>
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
                  <div className={css.cardActions}>
                    <button type="button" className={css.action} onClick={() => { void decide(request, false) }}>
                      {t('panel.deny')}
                    </button>
                    <button type="button" className={css.primary} onClick={() => { void decide(request, true) }}>
                      {t('panel.allow')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className={css.section}>
        <div className={css.headingRow}>
          <h3 className={css.heading}>{t('panel.devices')}</h3>
          {active.length > 0 && <span className={css.badge}>{active.length}</span>}
        </div>
        <p className={css.hint}>{t('panel.revokeHint')}</p>
        <p className={css.hint}>{t('panel.lifetimeNote')}</p>
        {active.length === 0
          ? <p className={css.status}>{t('panel.noDevices')}</p>
          : (
            <ul className={css.list}>
              {active.map((device) => {
                const selectedLifetime = device.lifetimeDays === undefined
                  ? undefined
                  : (LIFETIME_PRESETS as readonly number[]).includes(device.lifetimeDays)
                    ? String(device.lifetimeDays)
                    : CUSTOM_LIFETIME_ID
                return (
                  <li key={device.id} className={css.card}>
                    <div className={css.deviceHead}>
                      {renaming === device.id
                        ? (
                          <input
                            className={css.renameInput}
                            value={renameDraft}
                            maxLength={MAX_LABEL_LENGTH}
                            autoFocus
                            aria-label={t('panel.rename')}
                            onChange={(event) => { setRenameDraft(event.currentTarget.value) }}
                            onBlur={() => { void commitRename(device) }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') void commitRename(device)
                              if (event.key === 'Escape') setRenaming(undefined)
                            }}
                          />
                        )
                        : (
                          <button
                            type="button"
                            className={css.nameButton}
                            aria-label={t('panel.rename')}
                            onClick={() => {
                              setRenaming(device.id)
                              setRenameDraft(device.label)
                            }}
                          >
                            <span className={css.deviceLabel}>{device.label}</span>
                            <IconEditOutline16 className={css.editIcon} size={12} />
                          </button>
                        )}
                      <span className={css.chip}>{lifetimeOf(device)}</span>
                    </div>
                    {device.macAddress !== undefined && (
                      <div className={css.mac}>{t('panel.macLabel')} {device.macAddress}</div>
                    )}
                    <div className={css.status}>
                      {t('panel.registered', { time: formatStamp(device.registeredAt) })}
                      {' · '}
                      {t('panel.lastSeen', { time: formatStamp(device.lastSeenAt) })}
                    </div>
                    <div className={css.credentialRow}>
                      <span className={css.fieldLabel}>{t('panel.lifetimeField')}</span>
                      <Menu
                        open={lifetimeMenu === device.id}
                        portal
                        compact
                        anchor={(
                          <button
                            type="button"
                            className={css.selector}
                            onClick={() => { setLifetimeMenu(current => (current === device.id ? undefined : device.id)) }}
                          >
                            {device.lifetimeDays === undefined
                              ? t('panel.lifetimeUnknown')
                              : t('panel.lifetimePreset', { days: device.lifetimeDays })}
                            <IconChevronDownOutline14 />
                          </button>
                        )}
                        items={LIFETIME_PRESETS.map(days => ({ id: String(days), label: t('panel.lifetimePreset', { days }) }))}
                        footer={[{ id: CUSTOM_LIFETIME_ID, label: t('panel.lifetimeCustomEntry') }]}
                        selectedId={selectedLifetime}
                        onSelect={(id) => {
                          setLifetimeMenu(undefined)
                          if (id === CUSTOM_LIFETIME_ID) {
                            setCustomOpen(device.id)
                            return
                          }
                          setCustomOpen(current => (current === device.id ? undefined : current))
                          void setLifetime(device.id, Number(id))
                        }}
                        onClose={() => { setLifetimeMenu(undefined) }}
                      />
                    </div>
                    {customOpen === device.id && (
                      <div className={css.customRow}>
                        <label className={css.customField}>
                          {t('panel.lifetimeCustom')}
                          <input
                            className={css.daysInput}
                            type="number"
                            min={MIN_LIFETIME_DAYS}
                            max={MAX_LIFETIME_DAYS}
                            value={customDays[device.id] ?? ''}
                            onChange={(event) => {
                              const value = event.currentTarget.value
                              setCustomDays(current => ({ ...current, [device.id]: value }))
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className={css.action}
                          disabled={customDaysOf(device.id) === undefined}
                          onClick={() => {
                            const days = customDaysOf(device.id)
                            /* v8 ignore next -- defensive race guard behind the disabled button. */
                            if (days !== undefined) void setLifetime(device.id, days)
                          }}
                        >
                          {t('panel.lifetimeApply')}
                        </button>
                      </div>
                    )}
                    <div className={css.cardFoot}>
                      <button
                        type="button"
                        className={css.danger}
                        onClick={() => { void mutateDevice(() => api.revoke(device.id)) }}
                      >
                        {t('panel.revoke')}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
      </section>

      {binned.length > 0 && (
        <section className={css.section}>
          <div className={css.headingRow}>
            <h3 className={css.heading}>{t('panel.bin')}</h3>
            <span className={css.badge}>{binned.length}</span>
          </div>
          <p className={css.hint}>{t('panel.binHint')}</p>
          <ul className={css.list}>
            {binned.map(device => (
              <li key={device.id} className={css.binItem}>
                <div className={css.binText}>
                  <span className={css.deviceLabel}>{device.label}</span>
                  <span className={css.status}>{t('panel.revokedAt', { time: formatStamp(device.revokedAt) })}</span>
                </div>
                {confirmPurge === device.id
                  ? (
                    <div className={css.cardActions}>
                      <button type="button" className={css.action} onClick={() => { setConfirmPurge(undefined) }}>
                        {t('panel.purgeCancel')}
                      </button>
                      <button type="button" className={css.dangerSolid} onClick={() => { void purge(device.id) }}>
                        {t('panel.purgeConfirm')}
                      </button>
                    </div>
                  )
                  : (
                    <div className={css.cardActions}>
                      <button
                        type="button"
                        className={css.action}
                        onClick={() => { void mutateDevice(() => api.restore(device.id)) }}
                      >
                        {t('panel.restore')}
                      </button>
                      <button type="button" className={css.danger} onClick={() => { setConfirmPurge(device.id) }}>
                        {t('panel.purge')}
                      </button>
                    </div>
                  )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
