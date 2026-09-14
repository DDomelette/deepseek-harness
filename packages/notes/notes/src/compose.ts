/**
 * Composing what one material submits.
 *
 * An action contributes a prompt template, and the material contributes its own
 * body: a text material submits the template prepended to its body on its own
 * line, and a screenshot submits the durable reference the attachment store
 * returned, because the request part a model reads names that reference rather
 * than any text. The template is configuration, never a constant, so a
 * deployment can change what "translate" asks for without a code change.
 * @module @deepseek-ai/dsh-notes/compose
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
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
 * The content one material submits.
 * @param material - the stored material.
 * @param action - the action it names, as {@link actionFor} resolved it.
 * @returns one text block for a text material, with the action's prompt
 *   template prepended on its own line; for a screenshot, the action's template
 *   as a text block when it names one, followed by the image block naming the
 *   stored reference.
 */
export function composeContent(
  material: MaterialRecord,
  action: ActionDef | undefined,
): ContentBlock[] {
  if (material.image !== null) {
    return [
      ...action === undefined ? [] : [{ type: 'text', text: action.prompt } as const],
      { type: 'image', attachment: material.image },
    ]
  }
  return [{ type: 'text', text: submittedText(material, action) }]
}

/**
 * The text a text material submits.
 * @param material - the stored material.
 * @param action - the action it names, as {@link actionFor} resolved it.
 * @returns the body, with the action's prompt template prepended when set.
 */
function submittedText(material: MaterialRecord, action: ActionDef | undefined): string {
  const body = material.text ?? ''
  return action === undefined ? body : `${action.prompt}\n${body}`
}
