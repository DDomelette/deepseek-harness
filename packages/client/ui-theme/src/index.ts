/** Host registration for the browser theme preference and pre-plugin palette. */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { bootThemeInjection } from './boot-theme.ts'
import {
  FONT_SIZE_FIELD, THEME_PREFERENCE_FIELD, ThemeSettingsFields,
  type ThemePreference,
} from './theme-settings.ts'

export {
  DEFAULT_FONT_SIZE, DEFAULT_PREFERENCE, FONT_SIZE_FIELD, FONT_SIZE_MAX, FONT_SIZE_MIN,
  THEME_PREFERENCE_FIELD, THEME_PREFERENCES, THEME_SETTINGS_NAMESPACE,
  type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'

/** Runtime preferences projected to the browser. */
export interface Config {
  /** Browser palette preference. */
  preference: Volatile<ThemePreference>
  /** Conversation content font size in pixels. */
  fontSize: Volatile<number>
}

/** Live theme preferences; the entry id `ui-theme` is the settings namespace. */
export const Config = z.object({
  preference: ThemeSettingsFields[THEME_PREFERENCE_FIELD].volatile(),
  fontSize: ThemeSettingsFields[FONT_SIZE_FIELD].volatile(),
})

/**
 * Keep this instance off the generated Settings pages (the theme feature owns
 * its own Appearance and font-size rows) and answer every index injection
 * collection with the live theme bootstrap row.
 * @param ctx - Host context that may acquire the settings service.
 * @param config - the entry's live theme preferences.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  ctx.on('webserver/index-inject', (table) => {
    table.push(bootThemeInjection(config.preference.get(), config.fontSize.get()))
  }, { prepend: true })
}
