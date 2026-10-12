/** Host loader entry for the browser implementation exported from `./client`. */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

/** Runtime preference projected to the browser. */
export interface Config {
  /** Last acknowledged welcome notice version. */
  welcomeNoticeVersion: Volatile<string | undefined>
}

/** Live onboarding facts; the entry id `ui-settings-general` is the settings namespace. */
export const Config = z.object({
  welcomeNoticeVersion: z.string().volatile(),
})

/**
 * Keep this instance off the generated Settings pages: the shell owns its own
 * screens.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}
