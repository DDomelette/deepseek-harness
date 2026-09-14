/**
 * Composing the text one material submits.
 *
 * An action contributes a prompt template prepended to the body on its own
 * line. The template is configuration, never a constant, so a deployment can
 * change what "translate" asks for without a code change.
 * @module @deepseek-ai/dsh-notes/compose
 */

import type { MaterialRecord } from './domain.ts'
import type { ActionDef } from './settings.ts'

/**
 * The configured action one material names.
 * @param action - the action id stored on the material, or null for none.
 * @param actions - the currently configured actions.
 * @returns the action, or undefined when the material names none, or names one
 *   the current configuration no longer offers.
 */
export function actionFor(action: string | null, actions: readonly ActionDef[]): ActionDef | undefined {
  return action === null ? undefined : actions.find(candidate => candidate.id === action)
}

/**
 * The text one material submits.
 * @param material - the stored material.
 * @param action - the action it names, as {@link actionFor} resolved it.
 * @returns the body, with the action's prompt template prepended when set.
 */
export function composeBody(material: MaterialRecord, action: ActionDef | undefined): string {
  const body = material.text ?? ''
  return action === undefined ? body : `${action.prompt}\n${body}`
}
