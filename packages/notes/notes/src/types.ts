/**
 * Shared public types of the notes plugin: the two opaque ids, the material
 * vocabulary, and the source stamp a collected material carries.
 *
 * Identities are `Branded` from `@deepseek-ai/dsh-brand` rather than a
 * hand-rolled `string & { … }`: the repo brands every opaque cross-boundary id
 * through that one declaration. Types only — the durable schemas that mint
 * these brands live in `src/domain.ts`.
 * @module @deepseek-ai/dsh-notes/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Opaque id of one collected material. */
export type MaterialId = Branded<'material-id'>

/** Opaque id of one notes conversation. */
export type NoteSessionId = Branded<'note-session-id'>

/** How a material entered the notes. */
export type MaterialKind = 'text' | 'image'

/** Lifecycle of one material. */
export type MaterialStatus = 'draft' | 'analyzing' | 'analyzed' | 'failed'

/** Where a collected material came from. */
export interface MaterialSource {
  /** Session the text or image was collected from. */
  readonly sessionId: SessionId
  /** `chat` or `trajectory`, as the collecting surface reported it. */
  readonly view: string
  /** Source event sequence, when the collecting surface resolved one. */
  readonly seq: number | null
  /** Durable message id, when the source was a conversation message. */
  readonly messageId: string | null
  /** Tool call id, when the source was a tool row. */
  readonly callId: string | null
  /** Display label, resolved and localized at collection time. */
  readonly label: string
}
