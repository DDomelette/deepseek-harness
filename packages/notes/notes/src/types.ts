/**
 * Shared public types of the notes plugin: the opaque ids, the material
 * vocabulary, and the source stamp a collected material carries.
 *
 * Identities are `Branded` from `@deepseek-ai/dsh-brand` rather than a
 * hand-rolled `string & { … }`: the repo brands every opaque cross-boundary id
 * through that one declaration. Types only — the durable schemas that mint
 * these brands live in `src/domain.ts`.
 * @module @deepseek-ai/dsh-notes/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'

/** Opaque id of one collected material. */
export type MaterialId = Branded<'material-id'>

/** Opaque id of one notes conversation. */
export type NoteSessionId = Branded<'note-session-id'>

/** How a material entered the notes. */
export type MaterialKind = 'text' | 'image'

/** Lifecycle of one material. */
export type MaterialStatus = 'draft' | 'analyzing' | 'analyzed' | 'failed'

/** The views a material can be collected from. */
export type MaterialView = 'chat' | 'trajectory'

/** Where a collected material came from. */
export interface MaterialSource {
  /** Session the text or image was collected from. */
  readonly sessionId: SessionId
  /** The view the collecting surface reported. */
  readonly view: MaterialView
  /** Source event sequence, when the collecting surface resolved one. */
  readonly seq: SessionSeq | null
  /** Durable message id, when the source was a conversation message. */
  readonly messageId: MessageId | null
  /** Tool call id, when the source was a tool row. */
  readonly callId: string | null
  /** Display label, resolved and localized at collection time. */
  readonly label: string
}

/**
 * Wire vocabulary for the notes Remote namespace.
 *
 * Everything below is the browser's contract with the Host half: requests it
 * sends, values it receives, and the business failures it must handle. Types
 * only, so a generated Remote client can consume this module without importing
 * Host runtime code. Failures carry a stable `code` discriminant; the panel
 * matches on it and owns the localized wording.
 */

/** One notes conversation as the panel lists it. */
export interface NotesSessionSummary {
  /** Conversation id the panel addresses every session operation by. */
  readonly id: NoteSessionId
  /** The dsh Session behind this conversation. */
  readonly sessionId: SessionId
  /** Display title. */
  readonly title: string
  /** Creation instant, Unix epoch milliseconds. */
  readonly createdAt: number
  /** Archive instant, or null while the conversation is listed. */
  readonly archivedAt: number | null
}

/** One material as the panel lists and shows it. */
export interface NotesMaterialSummary {
  /** Material id. */
  readonly id: MaterialId
  /** Conversation that owns this material. */
  readonly noteId: NoteSessionId
  /** Whether the body is text or a screenshot. */
  readonly kind: MaterialKind
  /** Text body, or null for a material whose body is an image. */
  readonly text: string | null
  /** Whether a screenshot reference is stored for this material. */
  readonly hasImage: boolean
  /** Whether the material already entered its conversation, which fixes its text. */
  readonly submitted: boolean
  /** Where the material was collected from. */
  readonly source: MaterialSource
  /** Collection action that produced it, or null for a plain collection. */
  readonly action: string | null
  /** Manual order value; lower sorts nearer the top. */
  readonly order: number
  /** Lifecycle state. */
  readonly status: MaterialStatus
  /** Last failure reason, or null. */
  readonly error: string | null
  /** Creation instant, Unix epoch milliseconds. */
  readonly createdAt: number
  /** Archive instant, or null while the material is listed. */
  readonly archivedAt: number | null
}

/** List both buckets of one conversation's materials. */
export interface NotesMaterialListRequest {
  /** Conversation to read. */
  readonly noteId: NoteSessionId
}

/** Both material buckets of one conversation. */
export interface NotesMaterialListValue {
  /** Listed materials, top-most first. */
  readonly materials: readonly NotesMaterialSummary[]
  /** Archived materials, most recently archived first. */
  readonly archived: readonly NotesMaterialSummary[]
}

/** Every recorded conversation plus the active pointer. */
export interface NotesSessionListValue {
  /** Listed conversations, newest first. */
  readonly sessions: readonly NotesSessionSummary[]
  /** Archived conversations, most recently archived first. */
  readonly archived: readonly NotesSessionSummary[]
  /** Conversation the panel currently shows, or null when none exists. */
  readonly activeId: NoteSessionId | null
}

/** The newly recorded conversation. */
export interface NotesSessionCreateValue {
  /** Id of the conversation that was created and made active. */
  readonly id: NoteSessionId
}

/** Point the panel at one conversation. */
export interface NotesSessionSelectRequest {
  /** Conversation to make active. */
  readonly id: NoteSessionId
}

/** Archive one conversation. */
export interface NotesSessionArchiveRequest {
  /** Conversation to archive. */
  readonly id: NoteSessionId
}

/** Return one archived conversation to the list. */
export interface NotesSessionRestoreRequest {
  /** Conversation to restore. */
  readonly id: NoteSessionId
}

/** Collect one text material into a conversation. */
export interface NotesMaterialAddTextRequest {
  /** Conversation that receives the material. */
  readonly noteId: NoteSessionId
  /** Text body as the client collected it. */
  readonly text: string
  /** Where the text came from. */
  readonly source: MaterialSource
  /** Action that produced it, or null for a plain collection. */
  readonly action: string | null
}

/** Collect one screenshot into a conversation. */
export interface NotesMaterialAddImageRequest {
  /** Conversation that receives the material. */
  readonly noteId: NoteSessionId
  /** Canonical base64 of the encoded image bytes. */
  readonly data: string
  /** Media type the caller declares, which the attachment store verifies against the bytes. */
  readonly mediaType: NotesImageMediaType
  /** Where the image came from. */
  readonly source: MaterialSource
  /** Action that produced it, or null for a plain collection. */
  readonly action: string | null
}

/** Raster formats the attachment store accepts. */
export type NotesImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** The newly collected material. */
export interface NotesMaterialAddValue {
  /** Id of the material that was recorded. */
  readonly id: MaterialId
}

/** Replace one draft material's text. */
export interface NotesMaterialUpdateRequest {
  /** Material to edit. */
  readonly id: MaterialId
  /** Replacement body. */
  readonly text: string
}

/** Submit one material to its conversation for analysis. */
export interface NotesMaterialAnalyzeRequest {
  /** Material to analyse. */
  readonly id: MaterialId
}

/** Ask a follow-up inside one material's thread. */
export interface NotesMaterialAskRequest {
  /** Material whose thread receives the question. */
  readonly id: MaterialId
  /** The user's question. */
  readonly question: string
}

/** Move one material to its conversation's archived bucket. */
export interface NotesMaterialArchiveRequest {
  /** Material to archive. */
  readonly id: MaterialId
}

/** Return one archived material to the top of its conversation. */
export interface NotesMaterialRestoreRequest {
  /** Material to restore. */
  readonly id: MaterialId
}

/** Apply a complete manual ordering to one conversation. */
export interface NotesMaterialReorderRequest {
  /** Conversation whose order is being set. */
  readonly noteId: NoteSessionId
  /** Every visible material of that conversation, top first. */
  readonly orderedIds: readonly MaterialId[]
}

/** Delete one material record. */
export interface NotesMaterialRemoveRequest {
  /** Material to delete. */
  readonly id: MaterialId
}

/** Read one material's own thread from its conversation's log. */
export interface NotesMaterialThreadRequest {
  /** Material whose thread to read. */
  readonly id: MaterialId
}

/** One message of a material's thread. */
export interface NotesThreadRow {
  /** Whether the row is the material's own submission or the model's answer. */
  readonly role: 'user' | 'assistant'
  /** The row's text: every text part of the message, joined. */
  readonly text: string
  /** Whether the message carried an image part, which contributes no text. */
  readonly hasImage: boolean
  /** Session sequence the row came from, ascending within one thread. */
  readonly seq: number
}

/** One material's thread, in sequence order. */
export interface NotesThreadValue {
  /** The rows; empty while the conversation has not answered yet. */
  readonly rows: readonly NotesThreadRow[]
}

/** One collection action as the settings card shows it. */
export interface NotesActionView {
  /** Stable action id, stored as the material's own `action`. */
  readonly id: string
  /** Localized label the selection bubble shows. */
  readonly label: string
  /** Prompt text prepended to the material body before submission. */
  readonly prompt: string
  /** Whether picking the action analyses immediately, ignoring the strategy. */
  readonly autoSend: boolean
}

/** The notes settings section as the settings card shows it. */
export interface NotesSettingsView {
  /** `manual` waits for an explicit analyse; `auto` analyses each collection. */
  readonly strategy: 'manual' | 'auto'
  /** Collection actions the selection bubble offers. */
  readonly actions: readonly NotesActionView[]
  /** Absolute workspace path, or null before first-run setup has chosen one. */
  readonly workspace: string | null
  /** Model override for notes conversations, or null to follow the session default. */
  readonly model: NotesModelView | null
}

/** The model override one deployment resolved for its notes conversations. */
export interface NotesModelView {
  /** Registered provider route. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
  /** Adapter-owned reasoning effort, or null to use the route's own default. */
  readonly reasoningEffort: string | null
}

/**
 * One settings write: only the fields it names change. A field set to null
 * clears its user value and returns it to the composition default.
 */
export interface NotesSettingsUpdateRequest {
  /** Replacement model-call strategy. */
  readonly strategy?: 'manual' | 'auto'
  /**
   * Replacement collection actions, as the complete list. Null clears the user
   * value and returns the list to the composition default.
   */
  readonly actions?: readonly NotesActionView[] | null
  /** Replacement workspace path, or null to clear it. */
  readonly workspace?: string | null
  /** Replacement model override, or null to follow the session default. */
  readonly model?: {
    readonly provider: string
    readonly model: string
    /** Adapter-owned reasoning effort; null or absent uses the route's own default. */
    readonly reasoningEffort?: string | null
  } | null
}

/** Acknowledges a mutation that has no value to report. */
export interface NotesApplied {
  /** Stable postcondition shared by the first call and every retry. */
  readonly applied: true
}

/** No conversation record carries the requested id. */
export interface NotesSessionNotFound {
  readonly code: 'session-not-found'
  /** The id that is not recorded. */
  readonly id: NoteSessionId
}

/** No material record carries the requested id. */
export interface NotesMaterialNotFound {
  readonly code: 'material-not-found'
  /** The id that is not stored. */
  readonly id: MaterialId
}

/** The conversation has no workspace configured, so it cannot be started. */
export interface NotesWorkspaceMissing {
  readonly code: 'workspace-missing'
}

/** The addressed conversation is the last unarchived one. */
export interface NotesLastConversation {
  readonly code: 'last-conversation'
  /** The conversation that cannot be archived. */
  readonly id: NoteSessionId
}

/** The conversation's dsh Session is not live in this process. */
export interface NotesSessionNotLive {
  readonly code: 'session-not-live'
  /** The conversation whose Session is gone. */
  readonly id: NoteSessionId
}

/** The material already entered its conversation, so its body is fixed. */
export interface NotesMaterialSubmitted {
  readonly code: 'material-submitted'
  /** The material that can no longer be edited. */
  readonly id: MaterialId
}

/** The material has not entered its conversation, so it has no thread to ask in. */
export interface NotesMaterialNotSubmitted {
  readonly code: 'material-not-submitted'
  /** The material that is still a draft. */
  readonly id: MaterialId
}

/** The material's conversation runs on a route that declares text-only input. */
export interface NotesImageUnsupported {
  readonly code: 'image-unsupported'
  /** The screenshot that cannot enter that conversation. */
  readonly id: MaterialId
}

/** The material records a screenshot, so it has no text body to replace. */
export interface NotesMaterialNotText {
  readonly code: 'material-not-text'
  /** The material whose body is not text. */
  readonly id: MaterialId
}

/** The material names a collection action that is no longer configured. */
export interface NotesUnknownAction {
  readonly code: 'unknown-action'
  /** The action id the material carries. */
  readonly action: string
}

/** The deployment mounts no settings provider, so a write cannot be persisted. */
export interface NotesSettingsUnavailable {
  readonly code: 'settings-unavailable'
}

/**
 * A settings write carried a collection action the notes cannot use: an id,
 * label, or prompt that is blank once trimmed, or two actions sharing one id.
 */
export interface NotesInvalidActions {
  readonly code: 'invalid-actions'
}

/** The deployment mounts no attachment store, so an image cannot be stored. */
export interface NotesAttachmentsUnavailable {
  readonly code: 'attachments-unavailable'
}

/** Failures the notes operations can report. */
export type NotesFailure =
  | NotesSessionNotFound
  | NotesMaterialNotFound
  | NotesMaterialSubmitted
  | NotesMaterialNotSubmitted
  | NotesMaterialNotText
  | NotesWorkspaceMissing
  | NotesLastConversation
  | NotesSessionNotLive
  | NotesUnknownAction
  | NotesImageUnsupported
  | NotesSettingsUnavailable
  | NotesInvalidActions
  | NotesAttachmentsUnavailable
  | NotesSubmitRefused

/**
 * The inbox refused the message the notes built for one material, so nothing
 * was sent. The material keeps the refusal as its `error` and stays analysable.
 */
export interface NotesSubmitRefused {
  readonly code: 'submit-refused'
  /** The material whose submission was refused. */
  readonly id: MaterialId
  /** The reason the send reported. */
  readonly message: string
}

/**
 * Failures submitting one material for analysis can report. `Analysis.analyse`
 * returns exactly this set, so the operation and its wire result cannot drift.
 */
export type NotesAnalyzeFailure =
  | NotesMaterialNotFound
  | NotesSessionNotFound
  | NotesSessionNotLive
  | NotesUnknownAction
  | NotesImageUnsupported
  | NotesSubmitRefused

/** Failures asking a follow-up inside one material's thread can report. */
export type NotesAskFailure =
  | NotesMaterialNotFound
  | NotesMaterialNotSubmitted
  | NotesSessionNotFound
  | NotesSessionNotLive
  | NotesSubmitRefused

/** Failures reading one material's thread can report. */
export type NotesThreadFailure =
  | NotesMaterialNotFound
  | NotesSessionNotFound
  | NotesSessionNotLive

/** Successful public operation result. */
export interface NotesSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Rejected public operation result carrying a stable business failure. */
export interface NotesRejected<E extends NotesFailure> {
  readonly ok: false
  readonly error: E
}

/** Result of `notes/sessionList`. */
export type NotesSessionListResult = NotesSuccess<NotesSessionListValue>

/** Result of `notes/sessionCreate`. */
export type NotesSessionCreateResult =
  | NotesSuccess<NotesSessionCreateValue>
  | NotesRejected<NotesWorkspaceMissing>

/** Result of `notes/sessionSelect`. */
export type NotesSessionSelectResult =
  | NotesSuccess<NotesApplied>
  | NotesRejected<NotesSessionNotFound>

/** Result of `notes/sessionArchive`. */
export type NotesSessionArchiveResult =
  | NotesSuccess<NotesApplied>
  | NotesRejected<NotesSessionNotFound | NotesLastConversation>

/** Result of `notes/sessionRestore`. */
export type NotesSessionRestoreResult =
  | NotesSuccess<NotesApplied>
  | NotesRejected<NotesSessionNotFound>

/** Result of `notes/materialList`. */
export type NotesMaterialListResult =
  | NotesSuccess<NotesMaterialListValue>
  | NotesRejected<NotesSessionNotFound>

/** Result of `notes/materialAddText`. */
export type NotesMaterialAddResult =
  | NotesSuccess<NotesMaterialAddValue>
  | NotesRejected<NotesSessionNotFound | NotesAnalyzeFailure>

/** Result of `notes/materialAddImage`. */
export type NotesMaterialAddImageResult =
  | NotesSuccess<NotesMaterialAddValue>
  | NotesRejected<NotesSessionNotFound | NotesAttachmentsUnavailable | NotesAnalyzeFailure>

/** Result of `notes/materialUpdate`. */
export type NotesMaterialUpdateResult =
  | NotesSuccess<NotesApplied>
  | NotesRejected<NotesMaterialNotFound | NotesMaterialNotText | NotesMaterialSubmitted>

/** Result of `notes/materialAnalyze`. */
export type NotesMaterialAnalyzeResult =
  | NotesSuccess<NotesApplied>
  | NotesRejected<NotesAnalyzeFailure>

/** Result of `notes/materialAsk`. */
export type NotesMaterialAskResult =
  | NotesSuccess<NotesApplied>
  | NotesRejected<NotesAskFailure>

/** Result of `notes/materialArchive`. */
export type NotesMaterialArchiveResult =
  | NotesSuccess<NotesApplied>
  | NotesRejected<NotesMaterialNotFound>

/** Result of `notes/materialRestore`. */
export type NotesMaterialRestoreResult =
  | NotesSuccess<NotesApplied>
  | NotesRejected<NotesMaterialNotFound>

/** Result of `notes/materialReorder`. */
export type NotesMaterialReorderResult =
  | NotesSuccess<NotesApplied>
  | NotesRejected<NotesSessionNotFound | NotesMaterialNotFound>

/** Result of `notes/materialRemove`. */
export type NotesMaterialRemoveResult =
  | NotesSuccess<NotesApplied>
  | NotesRejected<NotesMaterialNotFound>

/** Result of `notes/materialThread`. */
export type NotesMaterialThreadResult =
  | NotesSuccess<NotesThreadValue>
  | NotesRejected<NotesThreadFailure>

/** Result of `notes/settingsRead`. */
export type NotesSettingsReadResult =
  | NotesSuccess<NotesSettingsView>
  | NotesRejected<NotesSettingsUnavailable>

/** Result of `notes/settingsUpdate`. */
export type NotesSettingsUpdateResult =
  | NotesSuccess<NotesApplied>
  | NotesRejected<NotesSettingsUnavailable | NotesInvalidActions>
