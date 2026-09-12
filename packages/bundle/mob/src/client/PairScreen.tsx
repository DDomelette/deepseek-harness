/**
 * The phone's pairing screen: it renders over the shell on `/pair`, shows the
 * code the computer displays, and polls the Host until the computer decides.
 * An approved request navigates to the application root, whose response
 * carries the device cookie.
 */
import { useEffect, useState } from 'react'
// Type-only: pulls the frame's slot declarations (shell.overlay).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './PairScreen.module.css'
import type { PairScreenKey } from './pair-locales.ts'

/** Delay between two state reads; the code lives two minutes, so a phone polls often enough to feel immediate. */
const POLL_INTERVAL_MILLISECONDS = 1_500

/** Whether the code is still waiting, or why it stopped. */
export type PairingStateView =
  | { readonly status: 'pending' }
  | { readonly status: 'approved' }
  | { readonly status: 'denied' }
  | { readonly status: 'expired' }
  | { readonly status: 'locked' }
  | { readonly status: 'unknown' }

/** Injected face: the claimed code, one state read, and the navigation on approval. */
export interface PairScreenInjected {
  /** Code the phone claimed, as the `/pair` shell carried it. */
  readonly code: string
  /** Read the Host's current decision for that code. */
  pollState: () => Promise<PairingStateView>
  /** Leave the pairing screen for the paired application. */
  navigate: (path: string) => void
}

/** Composed props: the overlay seat's runtime share, this screen's dictionary, and the injected face. */
export type PairScreenProps =
  & PropsRuntime<'shell.overlay'>
  & PropsLocale<'pair.mobile'>
  & PairScreenInjected

/** Copy key for one state; approval is momentary because the screen leaves. */
const STATUS_KEY = {
  pending: 'waiting',
  approved: 'waiting',
  denied: 'denied',
  expired: 'expired',
  locked: 'locked',
  unknown: 'expired',
} as const satisfies Record<PairingStateView['status'], PairScreenKey>

/** Structural view of what the Host's state route answers. */
function readState(value: unknown): PairingStateView {
  if (typeof value === 'object' && value !== null) {
    const status: unknown = Reflect.get(value, 'status')
    if (status === 'pending' || status === 'approved' || status === 'denied'
      || status === 'expired' || status === 'locked') {
      return { status }
    }
  }
  return { status: 'unknown' }
}

/**
 * Read the pairing boot fact the `/pair` shell carries.
 * @returns the claimed code, or undefined on every other page.
 */
export function pairingBootFact(): { code: string } | undefined {
  const value: unknown = Reflect.get(globalThis, '__DSH_PAIR__')
  if (typeof value !== 'object' || value === null) return undefined
  const code: unknown = Reflect.get(value, 'code')
  return typeof code === 'string' && code !== '' ? { code } : undefined
}

/**
 * Poll the Host's pairing state for the claimed code.
 * @param code - the claimed code.
 * @returns the Host's decision, or `unknown` for an unreadable answer.
 */
export async function readPairingState(code: string): Promise<PairingStateView> {
  const response = await fetch(`/pair/state?c=${encodeURIComponent(code)}`, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  })
  if (!response.ok) return { status: 'unknown' }
  return readState(await response.json())
}

/**
 * Render the pairing screen.
 * @param props - composed slot props and the injected pairing face.
 * @returns the screen element tree.
 */
export function PairScreen({ t, code, pollState, navigate }: PairScreenProps) {
  const [state, setState] = useState<PairingStateView>({ status: 'pending' })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (): Promise<void> => {
      let next: PairingStateView
      try {
        next = await pollState()
      } catch {
        // A failed read is a carrier problem, not a decision: keep waiting.
        next = { status: 'pending' }
      }
      if (cancelled) return
      setState(next)
      if (next.status === 'approved') {
        navigate('/')
        return
      }
      if (next.status === 'pending') timer = setTimeout(() => { void tick() }, POLL_INTERVAL_MILLISECONDS)
    }
    void tick()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [pollState, navigate])

  return (
    <div className={css.screen} data-pair-screen>
      <div className={css.card}>
        <div className={css.title}>{t('title')}</div>
        <div className={css.codeLabel}>{t('codeLabel')}</div>
        <div className={css.code}>{code}</div>
        <p className={css.status} role="status">{t(STATUS_KEY[state.status])}</p>
      </div>
    </div>
  )
}
