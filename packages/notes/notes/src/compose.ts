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
 * The text one material submits.
 * @param material - the stored material.
 * @param actions - the currently configured actions.
 * @returns the body, with the action's prompt template prepended when set.
 * @throws {Error} when the material names an action that is no longer configured.
 */
export function composeBody(material: MaterialRecord, actions: readonly ActionDef[]): string {
  const body = material.text ?? ''
  if (material.action === null) return body
  const action = actions.find(candidate => candidate.id === material.action)
  if (action === undefined) throw new Error(`notes: unknown action "${material.action}"`)
  return `${action.prompt}\n${body}`
}
