/**
 * dsh-mob browser half: the Connect-phone row in General settings, opening a
 * QR dialog over the `mob` Remote namespace, the pairing screen the `/pair`
 * shell shows on a phone that has no session yet, and the session-required
 * screen for a phone the Host served without accepting a session.
 *
 * Export discipline: packages/client/AGENTS.md.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge with the generated `mob` namespace.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the client Connection merge and its ConnectionHandle.
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the frame's slot declarations (shell.overlay).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the settings slot declarations (settings.general.item).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the mob failure vocabulary (`mob/loopback-only`), shared with the Host throw site.
import type {} from '../types.ts'
import { ConnectPhoneRow, type ConnectPhoneRowInjected } from './ConnectPhoneRow.tsx'
import { PairScreen, pairingBootFact, readPairingState, type PairScreenInjected } from './PairScreen.tsx'
import {
  AuthRequiredScreen, authRequiredBootFact, type AuthRequiredScreenInjected,
} from './AuthRequiredScreen.tsx'
import { createPairingApi } from './pairing-api.ts'
import { en, zh, type MobileSettingsKey } from './locales.ts'
import { en as pairEn, zh as pairZh, type PairScreenKey } from './pair-locales.ts'

export type { ConnectPhoneRowComponentProps, ConnectPhoneRowInjected } from './ConnectPhoneRow.tsx'
export type { AuthRequiredScreenInjected, AuthRequiredScreenProps } from './AuthRequiredScreen.tsx'
export type { MobileSettingsKey } from './locales.ts'
export type { PairScreenInjected, PairScreenProps, PairingStateView } from './PairScreen.tsx'
export type {
  PairedDeviceView, PairingApi, PairingFailureKind, PairingResult, PairingSessionView, PendingPairingView,
} from './pairing-api.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Connect-phone row and QR dialog copy. */
    'settings.mobile': MobileSettingsKey
    /** Phone pairing screen and session-required screen copy. */
    'pair.mobile': PairScreenKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.mobile'

/** Namespace of the pairing screen. */
const PAIR_NS = 'pair.mobile'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.mob']

/**
 * Register the dictionaries, the Connect-phone row once the General section's
 * item slot is declared, and whichever phone screen this page's boot facts call
 * for: the pairing screen on `/pair`, the session-required screen on a shell
 * the Host served without accepting a session.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-mob: connect-phone dictionaries')
  ctx.effect(() => ctx.locale.register(PAIR_NS, { zh: pairZh, en: pairEn }), 'dsh-mob: pairing dictionaries')
  const connection = ctx.get('connection') as ConnectionHandle
  const api = createPairingApi()
  const injected = (): ConnectPhoneRowInjected => ({
    joinUrl: () => ctx.remote.mob.joinUrl(),
    canDecide: connection.isLoopback,
    api,
  })
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'connect-phone',
    order: 30,
    locale: NS,
    inject: injected,
  }, ConnectPhoneRow))

  const paired = pairingBootFact()
  if (paired !== undefined) {
    // One stable injected object: the screen's poll effect keys on these
    // callbacks, so a fresh object per render would restart the loop.
    const pairInjected: PairScreenInjected = {
      code: paired.code,
      pollState: () => readPairingState(paired.code),
      navigate: (path) => { location.replace(path) },
    }
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'pair-screen',
      order: 100,
      locale: PAIR_NS,
      inject: () => pairInjected,
    }, PairScreen))
    return
  }

  if (!authRequiredBootFact()) return
  const authInjected: AuthRequiredScreenInjected = {
    reload: () => { location.reload() },
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'auth-required-screen',
    order: 90,
    locale: PAIR_NS,
    inject: () => authInjected,
  }, AuthRequiredScreen))
}
