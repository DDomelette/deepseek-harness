/**
 * The Connect-phone settings page: the pairing controls, plus the bind policy
 * the listener uses on the next launch. The policy rides the operator-gated
 * `/pair/bind` route rather than the settings RPC, so a paired phone can read
 * neither the deployment's address nor the write, and the operator can change
 * it from whichever address they actually opened — including the LAN one.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PairingPanel } from './PairingPanel.tsx'
import type { MobileBindMode, MobileBindSettings } from './bind-settings.ts'
import { createPairingApi, type PairingApi } from './pairing-api.ts'
import css from './MobileSection.module.css'

/** The three policies the page offers, in display order. */
const BIND_MODES: readonly MobileBindMode[] = ['loopback', 'auto', 'fixed']

/** Registration-side business face of {@link MobileSection}. */
export interface MobileSectionInjected {
  /** This Host's phone origin, from the `mob.joinUrl` Remote method. */
  joinUrl: () => Promise<RemoteResult<string>>
  /** The pairing routes' client half; it also carries the saved bind policy. */
  api?: PairingApi | undefined
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

/** The saved policy, as far as this page can tell. */
type PolicyRead =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: MobileBindSettings }
  /** The caller is not the operator, or the deployment saves no policy. */
  | { readonly status: 'readOnly' }
  | { readonly status: 'failed' }

/**
 * Render the Connect-phone settings page.
 * @param props - the runtime share, page copy, and injected pairing face.
 * @returns the page element tree.
 */
export function MobileSection({ joinUrl, api: providedApi, t }: MobileSectionProps): ReactNode {
  const api = useMemo(() => providedApi ?? createPairingApi(), [providedApi])
  const [policy, setPolicy] = useState<PolicyRead>({ status: 'loading' })
  const [draft, setDraft] = useState<MobileBindSettings | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<'saved' | 'failed' | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)
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

  useEffect(() => {
    let cancelled = false
    void api.bind().then((answer) => {
      if (cancelled) return
      if (answer.ok) setPolicy({ status: 'ready', value: answer.value })
      else setPolicy(answer.reason === 'forbidden' || answer.reason === 'gone' ? { status: 'readOnly' } : { status: 'failed' })
    })
    return () => { cancelled = true }
  }, [api, attempt])

  const saved = policy.status === 'ready' ? policy.value : undefined
  const current = draft ?? saved
  const fixedMissingAddress = current?.bindMode === 'fixed' && current.bindHost.trim() === ''

  // The controls below render only once a policy is readable, so each handler
  // receives that policy as its argument instead of re-checking it.
  const choose = (policy: MobileBindSettings, bindMode: MobileBindMode): void => {
    setNotice(undefined)
    setDraft({ bindMode, bindHost: policy.bindHost })
  }

  const editHost = (policy: MobileBindSettings, bindHost: string): void => {
    setNotice(undefined)
    setDraft({ bindMode: policy.bindMode, bindHost })
  }

  const save = async (policy: MobileBindSettings): Promise<void> => {
    setBusy(true)
    const answer = await api.saveBind({ bindMode: policy.bindMode, bindHost: policy.bindHost.trim() })
    setBusy(false)
    setNotice(answer.ok ? 'saved' : 'failed')
    if (answer.ok) {
      setPolicy({ status: 'ready', value: answer.value })
      setDraft(undefined)
    }
  }

  return (
    <section className={css.section} aria-label={t('dialog.title')}>
      <h2 className={css.title}>{t('dialog.title')}</h2>
      <p className={css.intro}>{t('dialog.description')}</p>

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

        {saved !== undefined && current !== undefined
          ? (
            <>
              <label className={css.field}>
                {t('access.mode')}
                <select
                  className={css.select}
                  value={current.bindMode}
                  disabled={busy}
                  onChange={(event) => { choose(current, event.currentTarget.value as MobileBindMode) }}
                >
                  {BIND_MODES.map(mode => (
                    <option key={mode} value={mode}>{t(`access.mode.${mode}`)}</option>
                  ))}
                </select>
              </label>

              <label className={css.field}>
                {t('access.host')}
                <input
                  className={css.input}
                  value={current.bindHost}
                  placeholder={t('access.hostPlaceholder')}
                  inputMode="decimal"
                  spellCheck={false}
                  disabled={busy || current.bindMode === 'loopback'}
                  onChange={(event) => { editHost(current, event.currentTarget.value) }}
                />
              </label>

              <p className={css.hint}>{t(`access.modeHint.${current.bindMode}`)}</p>
              <p className={css.hint}>{t('access.restart')}</p>
              {/* A paired cookie names its authority, so a new address or port
                  strands it; saying so keeps the operator from pairing again
                  without knowing why. */}
              <p className={css.warning}>{t('access.rebind')}</p>

              <div className={css.actions}>
                <button
                  type="button"
                  className={css.primary}
                  disabled={busy || fixedMissingAddress}
                  onClick={() => { void save(current) }}
                >
                  {t('access.save')}
                </button>
                {notice !== undefined && (
                  <p className={notice === 'saved' ? css.saved : css.failed} role="status">
                    {t(notice === 'saved' ? 'access.saved' : 'access.failed')}
                  </p>
                )}
              </div>
            </>
          )
          : (
            <>
              <p className={css.hint}>
                {policy.status === 'failed' ? t('panel.loadFailed') : t('access.readOnly')}
              </p>
              {policy.status === 'failed' && (
                <div className={css.actions}>
                  <button type="button" className={css.primary} onClick={() => {
                    setPolicy({ status: 'loading' })
                    setAttempt(current => current + 1)
                  }}>{t('panel.retry')}</button>
                </div>
              )}
            </>
          )}
      </section>

      <section className={css.block} aria-label={t('panel.heading')}>
        <PairingPanel t={t} joinUrl={joinUrl} api={api} />
      </section>
    </section>
  )
}
