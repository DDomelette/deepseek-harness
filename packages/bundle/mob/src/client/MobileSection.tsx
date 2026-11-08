/**
 * The Connect-phone settings page: the pairing controls that used to sit in a
 * General-settings dialog, plus the persistent bind address the listener uses
 * on the next launch. The address block writes the Host's `web-startup`
 * namespace, so a saved choice survives restarts; a phone that cannot manage
 * pairing sees the same panel without that block's write path succeeding.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PairingPanel } from './PairingPanel.tsx'
import type { MobileBindMode, MobileBindSettings } from './bind-settings.ts'
import type { PairingApi } from './pairing-api.ts'
import css from './MobileSection.module.css'

/** The three policies the page offers, in display order. */
const BIND_MODES: readonly MobileBindMode[] = ['loopback', 'auto', 'fixed']

/** Registration-side business face of {@link MobileSection}. */
export interface MobileSectionInjected {
  /** This Host's phone origin, from the `mob.joinUrl` Remote method. */
  joinUrl: () => Promise<RemoteResult<string>>
  /** The pairing routes' client half. */
  api?: PairingApi | undefined
  hooks: {
    /** Accepted bind policy, bound by the renderer as `useBind`. */
    bind: ObservableSnapshot<ConfigFormSnapshot<MobileBindSettings>>
  }
  /**
   * Persist one bind policy atomically.
   * @param settings - the mode and address the operator chose.
   * @returns whether the Host accepted the write.
   */
  saveBind: (settings: MobileBindSettings) => Promise<boolean>
}

/** Full component props: the slot's runtime share, this page's copy, and the injected face. */
export type MobileSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.mobile'>
  & InjectFace<MobileSectionInjected>

/** The reachability answer the page shows above the controls. */
type Reach =
  | { readonly status: 'pending' }
  | { readonly status: 'reachable'; readonly url: string }
  | { readonly status: 'local' }

/**
 * Render the Connect-phone settings page.
 * @param props - the runtime share, page copy, and injected pairing face.
 * @returns the page element tree.
 */
export function MobileSection({ useBind, joinUrl, api, saveBind, t }: MobileSectionProps): ReactNode {
  const bind = useBind(snapshot => snapshot)
  const [draft, setDraft] = useState<MobileBindSettings | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<'saved' | 'failed' | undefined>(undefined)
  const [reach, setReach] = useState<Reach>({ status: 'pending' })
  // One read per mount: the answer changes only with a restart, and the injected
  // callback's identity follows the registration, so an effect keyed on it
  // would re-read on every render.
  const [lookup] = useState(() => joinUrl())

  useEffect(() => {
    let cancelled = false
    void lookup.then((answer) => {
      if (cancelled) return
      setReach(answer.ok ? { status: 'reachable', url: answer.value } : { status: 'local' })
    })
    return () => { cancelled = true }
  }, [lookup])

  const saved = bind.value
  const current = draft ?? saved
  const fixedMissingAddress = current?.bindMode === 'fixed' && current.bindHost.trim() === ''

  const choose = (bindMode: MobileBindMode): void => {
    if (current === undefined) return
    setNotice(undefined)
    setDraft({ bindMode, bindHost: current.bindHost })
  }

  const editHost = (bindHost: string): void => {
    if (current === undefined) return
    setNotice(undefined)
    setDraft({ bindMode: current.bindMode, bindHost })
  }

  const save = async (): Promise<void> => {
    if (current === undefined || busy) return
    setBusy(true)
    const accepted = await saveBind({ bindMode: current.bindMode, bindHost: current.bindHost.trim() })
    setBusy(false)
    setNotice(accepted ? 'saved' : 'failed')
    if (accepted) setDraft(undefined)
  }

  return (
    <section className={css.section} aria-label={t('dialog.title')}>
      <h2 className={css.title}>{t('dialog.title')}</h2>
      <p className={css.intro}>{t('dialog.description')}</p>

      {saved === undefined && <p className={css.hint}>{t('access.readOnly')}</p>}

      {saved !== undefined && current !== undefined && (
        <section className={css.block}>
          <h3 className={css.heading}>{t('access.title')}</h3>
          <dl className={css.facts}>
            <dt className={css.factLabel}>{t('access.current')}</dt>
            <dd className={css.factValue}>
              <code className={css.address}>{globalThis.location.host}</code>
            </dd>
            <dt className={css.factLabel}>{t('access.phone')}</dt>
            <dd className={css.factValue}>
              {reach.status === 'reachable' ? t('access.reachable', { url: reach.url }) : t('access.unreachable')}
            </dd>
          </dl>

          <label className={css.field}>
            {t('access.mode')}
            <select
              className={css.select}
              value={current.bindMode}
              disabled={busy || !bind.writable}
              onChange={(event) => { choose(event.currentTarget.value as MobileBindMode) }}
            >
              {BIND_MODES.map(mode => (
                <option key={mode} value={mode}>{t(`access.mode.${mode}`)}</option>
              ))}
            </select>
          </label>

          {current.bindMode === 'fixed' && (
            <label className={css.field}>
              {t('access.host')}
              <input
                className={css.input}
                value={current.bindHost}
                placeholder={t('access.hostPlaceholder')}
                inputMode="decimal"
                spellCheck={false}
                disabled={busy || !bind.writable}
                onChange={(event) => { editHost(event.currentTarget.value) }}
              />
            </label>
          )}

          <p className={css.hint}>{t(`access.modeHint.${current.bindMode}`)}</p>
          <p className={css.hint}>{t('access.restart')}</p>

          <div className={css.actions}>
            <button
              type="button"
              className={css.primary}
              disabled={busy || !bind.writable || fixedMissingAddress}
              onClick={() => { void save() }}
            >
              {t('access.save')}
            </button>
            {notice !== undefined && (
              <p className={notice === 'saved' ? css.saved : css.failed} role="status">
                {t(notice === 'saved' ? 'access.saved' : 'access.failed')}
              </p>
            )}
          </div>
        </section>
      )}

      <section className={css.block} aria-label={t('panel.heading')}>
        <PairingPanel t={t} joinUrl={joinUrl} api={api} />
      </section>
    </section>
  )
}
