/** Host registration for the browser locale preference. */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { LOCALE_PREFERENCE_FIELD, LocaleSettingsFields } from './locale-settings.ts'
import type { LocaleId } from './locale-settings.ts'

export {
  LOCALE_IDS, LOCALE_PREFERENCE_FIELD, LOCALE_SETTINGS_NAMESPACE,
  type BuiltInLocaleId, type LocaleId, type LocaleSettings,
} from './locale-settings.ts'

/** Runtime preference projected to the browser. */
export interface Config {
  /** Explicit locale; omission follows the browser. */
  preference: Volatile<LocaleId | undefined>
}

/** Live preference; the entry id `locale` is the settings namespace. */
export const Config = z.object({
  preference: LocaleSettingsFields[LOCALE_PREFERENCE_FIELD].volatile(),
})

/**
 * Keep this instance off the generated Settings pages: the browser plugin owns
 * the language surface.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}
