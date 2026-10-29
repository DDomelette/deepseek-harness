/**
 * Reading one material's collection action out of the settings section.
 *
 * A material records the action's id, and the section holds the label and the
 * prompt template that go with it, so the row that names the action and the
 * detail that echoes the template resolve it the same way. The Host applies the
 * same rule to the same ids when it composes a submission (`actionFor` in
 * `src/compose.ts`); this half only says what the reader sees.
 * @module @deepseek-ai/dsh-notes/client/actions
 */
import type { NotesActionView } from '../types.ts'

/** What one material's action badge shows. */
export interface ActionBadge {
  /** The action id stored on the material. */
  readonly id: string
  /** The configured label, or the id when the configuration dropped the action. */
  readonly label: string
}

/**
 * The configured action one material names.
 * @param action - the action id stored on the material, or null for none.
 * @param actions - the collection actions the settings section lists.
 * @returns the action, or undefined when the material names none, or names one
 *   the current configuration no longer offers.
 */
export function configuredAction(
  action: string | null,
  actions: readonly NotesActionView[],
): NotesActionView | undefined {
  return action === null ? undefined : actions.find(candidate => candidate.id === action)
}

/**
 * The badge one material's row shows for its action.
 * @param action - the action id stored on the material, or null for none.
 * @param actions - the collection actions the settings section lists.
 * @returns the id and the configured label, or null when the material names no
 *   action and the row therefore carries no badge.
 */
export function actionBadge(
  action: string | null,
  actions: readonly NotesActionView[],
): ActionBadge | null {
  if (action === null) return null
  return { id: action, label: configuredAction(action, actions)?.label ?? action }
}
