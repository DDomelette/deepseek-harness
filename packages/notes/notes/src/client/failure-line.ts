/**
 * The failure line one notes refusal deserves.
 *
 * Kept apart from the components so the mapping is testable on its own. Two
 * kinds of failure reach it: the Host's own business refusals, which name a
 * condition, and a carrier failure, which carries only the transport's message.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { NotesFailure } from '../types.ts'

/** What the panel reports when a call did not produce a value. */
export type NotesPanelFailure =
  | NotesFailure
  | { readonly code: 'remote-unavailable'; readonly message: string }
  | { readonly code: 'image-unsupported' }
  | { readonly code: 'image-unreadable' }

/**
 * Say what went wrong in terms of the notes, not of the transport.
 * @param t - namespace-bound translate.
 * @param failure - the settled failure.
 * @returns the line to show in place of the panel's content.
 */
export function failureLine(t: TranslateNS<'notes'>, failure: NotesPanelFailure): string {
  switch (failure.code) {
    case 'session-not-found': return t('error.sessionNotFound')
    case 'material-not-found': return t('error.materialNotFound')
    case 'material-submitted': return t('error.materialSubmitted')
    case 'workspace-missing': return t('error.workspaceMissing')
    case 'last-conversation': return t('error.lastConversation')
    case 'session-not-live': return t('error.sessionNotLive')
    case 'unknown-action': return t('error.unknownAction')
    case 'settings-unavailable': return t('error.settingsUnavailable')
    case 'attachments-unavailable': return t('error.attachmentsUnavailable')
    case 'image-unsupported': return t('error.imageUnsupported')
    case 'image-unreadable': return t('error.imageUnreadable')
    case 'remote-unavailable': return t('error.remoteUnavailable', { message: failure.message })
  }
}
