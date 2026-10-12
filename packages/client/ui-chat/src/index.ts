/** Host registration for browser Chat preferences. */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { ChatSettingsFields, TRANSCRIPT_VIEW_FIELD } from './chat-settings.ts'
import type { ChatSettings } from './chat-settings.ts'

export {
  CHAT_SETTINGS_NAMESPACE, DEFAULT_TRANSCRIPT_VIEW_MODE, TRANSCRIPT_VIEW_FIELD,
  TRANSCRIPT_VIEW_MODES, type ChatSettings, type TranscriptViewMode,
} from './chat-settings.ts'

/** Runtime preference projected to the browser. */
export interface Config {
  /** Completed turn transcript presentation. */
  transcriptView: Volatile<ChatSettings['transcriptView']>
}

/** Live preference; the entry id `ui-chat` is the settings namespace. */
export const Config = z.object({
  transcriptView: ChatSettingsFields[TRANSCRIPT_VIEW_FIELD].volatile(),
})

/**
 * Keep this instance off the generated Settings pages: the browser plugin owns
 * the Chat surface.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}
