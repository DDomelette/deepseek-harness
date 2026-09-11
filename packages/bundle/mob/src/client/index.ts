/**
 * dsh-mob browser half: the Connect-phone row in General settings, opening a
 * QR dialog over the `mob` Remote namespace.
 *
 * Export discipline: packages/client/AGENTS.md.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge with the generated `mob` namespace.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings slot declarations (settings.general.item).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the mob failure vocabulary (`mob/loopback-only`), shared with the Host throw site.
import type {} from '../types.ts'
import { ConnectPhoneRow, type ConnectPhoneRowInjected } from './ConnectPhoneRow.tsx'
import { en, zh, type MobileSettingsKey } from './locales.ts'

export type { ConnectPhoneRowComponentProps, ConnectPhoneRowInjected } from './ConnectPhoneRow.tsx'
export type { MobileSettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Connect-phone row and QR dialog copy. */
    'settings.mobile': MobileSettingsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.mobile'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.mob']

/**
 * Register the dictionaries and the Connect-phone row once the General
 * section's item slot is declared.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-mob: connect-phone dictionaries')
  const injected = (): ConnectPhoneRowInjected => ({
    joinUrl: () => ctx.remote.mob.joinUrl(),
  })
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'connect-phone',
    order: 30,
    locale: NS,
    inject: injected,
  }, ConnectPhoneRow))
}
