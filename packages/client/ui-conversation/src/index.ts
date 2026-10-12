/** Host registration for browser conversation preferences. */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { BUSY_ENTER_FIELD, ConversationSettingsFields } from './submission-settings.ts'
import type { BusyEnterBehavior } from './submission-settings.ts'

export {
  BUSY_ENTER_BEHAVIORS, BUSY_ENTER_FIELD, CONVERSATION_SETTINGS_NAMESPACE,
  DEFAULT_BUSY_ENTER_BEHAVIOR, type BusyEnterBehavior, type ConversationSettings,
} from './submission-settings.ts'

/** Runtime preference projected to the browser. */
export interface Config {
  /** Enter key behavior while a turn is running. */
  busyEnter: Volatile<BusyEnterBehavior>
}

/** Live preference; the entry id `ui-conversation` is the settings namespace. */
export const Config = z.object({
  busyEnter: ConversationSettingsFields[BUSY_ENTER_FIELD].volatile(),
})

/**
 * Keep this instance off the generated Settings pages: the browser plugin owns
 * the conversation surface.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}
