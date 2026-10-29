/**
 * Stage one of the notes tab's registration: what the type IS.
 *
 * A page type: the panel views nothing in the session it sits beside, so it
 * recognizes no resource address and is opened by kind from its own control in
 * the conversation header.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

/** This implementation's identity in the tab system: the key its body registers under. */
export const NOTES_ID = '@deepseek-ai/dsh-notes'

/** The tab kind the notes panel is opened by. */
export const NOTES_KIND = 'notes'

/**
 * The notes type's registry definition.
 * @param t - namespace-bound translate, read fresh on every title call.
 * @returns the definition to register.
 */
export function notesDefinition(t: TranslateNS<'notes'>): SidebarRightTabDefinition {
  return {
    id: NOTES_ID,
    kind: NOTES_KIND,
    priority: 'builtin',
    title: () => t('tab.title'),
  }
}
