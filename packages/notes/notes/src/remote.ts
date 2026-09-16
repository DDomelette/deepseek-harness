/**
 * The notes Remote namespace: what the browser panel can ask the Host to do.
 *
 * Every operation answers with the vocabulary in `types.ts` instead of
 * throwing. A caller across the wire cannot see an exception type, and the
 * panel has to explain each refusal next to the row that caused it, so the
 * conditions the owning services enforce are asked for by name before the
 * call — never inferred from a caught error.
 *
 * Reads are synchronous snapshots of the domain's in-memory tables; every
 * write goes through the service that owns the rule it applies.
 * @module @deepseek-ai/dsh-notes/remote
 */

import { Buffer } from 'node:buffer'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-attachment'
import type { MaterialRecord } from './domain.ts'
import type { StoredMaterial } from './materials.ts'
import type { StoredNoteSession } from './note-sessions.ts'
import type {
  MaterialId, MaterialSource, NoteSessionId,
  NotesApplied, NotesFailure, NotesMaterialAddImageRequest, NotesMaterialAddImageResult,
  NotesMaterialAddResult, NotesMaterialAddTextRequest,
  NotesMaterialAnalyzeRequest, NotesMaterialAnalyzeResult, NotesMaterialArchiveRequest,
  NotesMaterialArchiveResult, NotesMaterialAskRequest, NotesMaterialAskResult,
  NotesMaterialListRequest, NotesMaterialListResult, NotesMaterialRemoveRequest,
  NotesMaterialRemoveResult, NotesMaterialReorderRequest, NotesMaterialReorderResult,
  NotesMaterialRestoreRequest, NotesMaterialRestoreResult, NotesMaterialSummary,
  NotesMaterialThreadRequest, NotesMaterialThreadResult, NotesMaterialUpdateRequest,
  NotesMaterialUpdateResult, NotesRejected,
  NotesSessionArchiveRequest, NotesSessionArchiveResult, NotesSessionCreateResult,
  NotesSessionListResult, NotesSessionRestoreRequest, NotesSessionRestoreResult,
  NotesSessionSelectRequest, NotesSessionSelectResult, NotesSettingsReadResult,
  NotesSettingsUpdateRequest, NotesSettingsUpdateResult, NotesSessionSummary,
  NotesAnalyzeFailure,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `notes` Remote namespace. */
    notes: NotesRemote
  }
}

/** The acknowledgment every valueless notes mutation reports. */
const APPLIED: NotesApplied = Object.freeze({ applied: true as const })

/**
 * Host owner of the `notes` Remote namespace.
 *
 * The service key doubles as the wire namespace, so the panel calls these as
 * `notes/sessionList`, `notes/materialAnalyze`, and so on.
 */
export class NotesRemote extends TypertRemoteService {
  static inject = ['notesStore', 'notesMaterials', 'notesSessions', 'notesAnalysis']

  /** @param ctx - host context carrying the notes services. */
  constructor(ctx: Context) {
    super(ctx, 'notes')
  }

  /**
   * Every recorded conversation, the archived ones separated, plus the pointer
   * the panel reopens.
   * @returns the listed and archived conversations.
   */
  @Remote
  sessionList(): NotesSessionListResult {
    return success({
      sessions: this.ctx.notesSessions.list().map(sessionSummary),
      archived: this.ctx.notesSessions.archived().map(sessionSummary),
      activeId: this.ctx.notesSessions.active(),
    })
  }

  /**
   * Start a conversation over the configured workspace and model, and make it
   * the active one.
   * @returns the recorded conversation id, or the missing-workspace refusal.
   */
  @Remote
  async sessionCreate(): Promise<NotesSessionCreateResult> {
    if (!this.ctx.notesSessions.hasWorkspace()) return rejected({ code: 'workspace-missing' })
    return success({ id: await this.ctx.notesSessions.create() })
  }

  /**
   * Point the panel at one conversation.
   * @param request - the conversation to make active.
   * @returns the acknowledgment, or the unknown-conversation refusal.
   */
  @Remote
  async sessionSelect(request: NotesSessionSelectRequest): Promise<NotesSessionSelectResult> {
    if (this.ctx.notesSessions.get(request.id) === undefined) {
      return rejected({ code: 'session-not-found', id: request.id })
    }
    await this.ctx.notesSessions.setActive(request.id)
    return success(APPLIED)
  }

  /**
   * Archive one conversation, moving the active pointer when it pointed there.
   * @param request - the conversation to archive.
   * @returns the acknowledgment, or the refusal that stopped it.
   */
  @Remote
  async sessionArchive(request: NotesSessionArchiveRequest): Promise<NotesSessionArchiveResult> {
    if (this.ctx.notesSessions.get(request.id) === undefined) {
      return rejected({ code: 'session-not-found', id: request.id })
    }
    if (!this.ctx.notesSessions.canArchive(request.id)) {
      return rejected({ code: 'last-conversation', id: request.id })
    }
    await this.ctx.notesSessions.archive(request.id)
    return success(APPLIED)
  }

  /**
   * Return one archived conversation to the list and make it active.
   * @param request - the conversation to restore.
   * @returns the acknowledgment, or the unknown-conversation refusal.
   */
  @Remote
  async sessionRestore(request: NotesSessionRestoreRequest): Promise<NotesSessionRestoreResult> {
    if (this.ctx.notesSessions.get(request.id) === undefined) {
      return rejected({ code: 'session-not-found', id: request.id })
    }
    await this.ctx.notesSessions.restore(request.id)
    return success(APPLIED)
  }

  /**
   * Both material buckets of one conversation.
   * @param request - the conversation to read.
   * @returns the materials and the archived ones, or the unknown-conversation refusal.
   */
  @Remote
  materialList(request: NotesMaterialListRequest): NotesMaterialListResult {
    if (this.ctx.notesSessions.get(request.noteId) === undefined) {
      return rejected({ code: 'session-not-found', id: request.noteId })
    }
    return success({
      materials: this.ctx.notesMaterials.list(request.noteId).map(materialSummary),
      archived: this.ctx.notesMaterials.archived(request.noteId).map(materialSummary),
    })
  }

  /**
   * Collect one text material into a conversation. A material the deployment's
   * strategy submits on collection is submitted before the answer returns, so
   * the panel never has to decide whether to ask for the analysis itself.
   * @param request - the conversation, body, source, and action.
   * @returns the new material id, or the unknown-conversation refusal.
   */
  @Remote
  async materialAddText(request: NotesMaterialAddTextRequest): Promise<NotesMaterialAddResult> {
    if (this.ctx.notesSessions.get(request.noteId) === undefined) {
      return rejected({ code: 'session-not-found', id: request.noteId })
    }
    const record = this.draft(request, { kind: 'text', text: request.text, image: null })
    const outcome = await this.collect(record, request.action)
    return outcome.ok ? success({ id: outcome.id }) : rejected(outcome.failure)
  }

  /**
   * Collect one screenshot into a conversation. The bytes go to the deployment's
   * attachment store and the material keeps only the durable reference, so a
   * material's own record stays small and an image is stored once.
   * @param request - the conversation, image bytes, media type, source, and action.
   * @returns the new material id, or the refusal that stopped the collection.
   */
  @Remote
  async materialAddImage(request: NotesMaterialAddImageRequest): Promise<NotesMaterialAddImageResult> {
    if (this.ctx.notesSessions.get(request.noteId) === undefined) {
      return rejected({ code: 'session-not-found', id: request.noteId })
    }
    const attachments = this.ctx.get('attachments')
    if (attachments === undefined) return rejected({ code: 'attachments-unavailable' })
    const stored = await attachments.saveImage({
      data: Buffer.from(request.data, 'base64'),
      mediaType: request.mediaType,
    })
    const record = this.draft(request, { kind: 'image', text: null, image: stored })
    const outcome = await this.collect(record, request.action)
    return outcome.ok ? success({ id: outcome.id }) : rejected(outcome.failure)
  }

  /**
   * Replace one draft material's body. A material that already entered its
   * conversation keeps the body it submitted: the session log carries that
   * text, and rewriting the record would desync the row from its thread. A
   * screenshot has no text body at all: its body is the reference it was stored
   * as, which only a new collection replaces.
   * @param request - the material and its replacement body.
   * @returns the acknowledgment, or the refusal that stopped it.
   */
  @Remote
  async materialUpdate(request: NotesMaterialUpdateRequest): Promise<NotesMaterialUpdateResult> {
    const material = this.ctx.notesMaterials.get(request.id)
    if (material === undefined) return rejected({ code: 'material-not-found', id: request.id })
    if (material.kind === 'image') return rejected({ code: 'material-not-text', id: request.id })
    if (material.messageIds.length > 0) return rejected({ code: 'material-submitted', id: request.id })
    await this.ctx.notesMaterials.update(request.id, record => ({ ...record, text: request.text }))
    return success(APPLIED)
  }

  /**
   * Submit one material to its conversation for analysis.
   * @param request - the material to analyse.
   * @returns the acknowledgment, or the refusal that stopped the submission.
   */
  @Remote
  async materialAnalyze(request: NotesMaterialAnalyzeRequest): Promise<NotesMaterialAnalyzeResult> {
    const failure = await this.ctx.notesAnalysis.analyse(request.id)
    return failure === null ? success(APPLIED) : rejected(failure)
  }

  /**
   * Ask a follow-up inside one material's thread.
   * @param request - the material and the question.
   * @returns the acknowledgment, or the refusal that stopped the question.
   */
  @Remote
  async materialAsk(request: NotesMaterialAskRequest): Promise<NotesMaterialAskResult> {
    const failure = await this.ctx.notesAnalysis.ask(request.id, request.question)
    return failure === null ? success(APPLIED) : rejected(failure)
  }

  /**
   * Move one material to its conversation's archived bucket.
   * @param request - the material to archive.
   * @returns the acknowledgment, or the unknown-material refusal.
   */
  @Remote
  async materialArchive(request: NotesMaterialArchiveRequest): Promise<NotesMaterialArchiveResult> {
    if (this.ctx.notesMaterials.get(request.id) === undefined) {
      return rejected({ code: 'material-not-found', id: request.id })
    }
    await this.ctx.notesMaterials.archive(request.id)
    return success(APPLIED)
  }

  /**
   * Return one archived material to the top of its conversation.
   * @param request - the material to restore.
   * @returns the acknowledgment, or the unknown-material refusal.
   */
  @Remote
  async materialRestore(request: NotesMaterialRestoreRequest): Promise<NotesMaterialRestoreResult> {
    if (this.ctx.notesMaterials.get(request.id) === undefined) {
      return rejected({ code: 'material-not-found', id: request.id })
    }
    await this.ctx.notesMaterials.restore(request.id)
    return success(APPLIED)
  }

  /**
   * Apply a complete manual ordering to one conversation.
   * @param request - the conversation and its materials, top first.
   * @returns the acknowledgment, or the refusal that stopped the reorder.
   */
  @Remote
  async materialReorder(request: NotesMaterialReorderRequest): Promise<NotesMaterialReorderResult> {
    if (this.ctx.notesSessions.get(request.noteId) === undefined) {
      return rejected({ code: 'session-not-found', id: request.noteId })
    }
    const rejectedId = request.orderedIds.find(
      id => !this.ctx.notesMaterials.isVisible(request.noteId, id),
    )
    if (rejectedId !== undefined) return rejected({ code: 'material-not-found', id: rejectedId })
    await this.ctx.notesMaterials.reorder(request.noteId, request.orderedIds)
    return success(APPLIED)
  }

  /**
   * The notes settings section as this deployment resolves it.
   * @returns the current settings, or the refusal when no provider is mounted.
   */
  @Remote
  settingsRead(): NotesSettingsReadResult {
    if (!this.ctx.notesSettings.writable()) return rejected({ code: 'settings-unavailable' })
    return success({
      strategy: this.ctx.notesSettings.strategy(),
      actions: this.ctx.notesSettings.actions().map(action => ({ ...action })),
      workspace: this.ctx.notesSettings.workspace(),
      model: this.ctx.notesSettings.model(),
    })
  }

  /**
   * Write the fields one settings patch names.
   * @param request - the fields to change.
   * @returns the acknowledgment, or the refusal when no provider is mounted.
   */
  @Remote
  async settingsUpdate(request: NotesSettingsUpdateRequest): Promise<NotesSettingsUpdateResult> {
    if (!this.ctx.notesSettings.writable()) return rejected({ code: 'settings-unavailable' })
    const invalid = await this.ctx.notesSettings.update({
      ...request.strategy === undefined ? {} : { strategy: request.strategy },
      ...'actions' in request ? { actions: request.actions ?? null } : {},
      ...'workspace' in request ? { workspace: request.workspace ?? null } : {},
      ...'model' in request ? { model: request.model ?? null } : {},
    })
    if (invalid !== null) return rejected(invalid)
    return success(APPLIED)
  }

  /**
   * Read one material's own thread from its conversation's log.
   * @param request - the material whose thread to read.
   * @returns the rows in sequence order, or the refusal that stopped the read.
   */
  @Remote
  materialThread(request: NotesMaterialThreadRequest): NotesMaterialThreadResult {
    const read = this.ctx.notesAnalysis.thread(request.id)
    return read.ok ? success({ rows: read.rows }) : rejected(read.failure)
  }

  /**
   * Delete one material record. The conversation's session log and its archived
   * bucket are untouched.
   * @param request - the material to delete.
   * @returns the acknowledgment, or the unknown-material refusal.
   */
  @Remote
  async materialRemove(request: NotesMaterialRemoveRequest): Promise<NotesMaterialRemoveResult> {
    if (this.ctx.notesMaterials.get(request.id) === undefined) {
      return rejected({ code: 'material-not-found', id: request.id })
    }
    await this.ctx.notesMaterials.remove(request.id)
    return success(APPLIED)
  }

  /**
   * One new draft record over a collection request's own facts.
   * @param request - the conversation, source, and action the caller collected under.
   * @param body - the body this kind of material records.
   * @returns the complete record to store.
   */
  private draft(
    request: {
      readonly noteId: NoteSessionId
      readonly source: MaterialSource
      readonly action: string | null
    },
    body: Pick<MaterialRecord, 'kind' | 'text' | 'image'>,
  ): MaterialRecord {
    return {
      noteId: request.noteId,
      ...body,
      source: request.source,
      action: request.action,
      order: 0,
      status: 'draft',
      messageIds: [],
      error: null,
      createdAt: Date.now(),
      archivedAt: null,
    }
  }

  /**
   * Store one collected material and submit it when this deployment's strategy,
   * or the action it names, asks for that.
   * @param record - the complete record to store.
   * @param action - the collection action the material names, or null for none.
   * @returns the stored id, or the refusal the submission produced. A refused
   *   submission leaves the material stored and marked `failed`.
   */
  private async collect(
    record: MaterialRecord,
    action: string | null,
  ): Promise<{ readonly ok: true; readonly id: MaterialId } | { readonly ok: false; readonly failure: NotesAnalyzeFailure }> {
    const id = await this.ctx.notesMaterials.create(record)
    if (!this.ctx.notesAnalysis.submitsOnCollection(action)) return { ok: true, id }
    const refused = await this.ctx.notesAnalysis.analyse(id)
    return refused === null ? { ok: true, id } : { ok: false, failure: refused }
  }
}

/** One stored conversation as the panel lists it. */
function sessionSummary(stored: StoredNoteSession): NotesSessionSummary {
  return {
    id: stored.id,
    sessionId: stored.sessionId,
    title: stored.title,
    createdAt: stored.createdAt,
    archivedAt: stored.archivedAt,
  }
}

/** One stored material as the panel shows it, detached from the stored record. */
function materialSummary(stored: StoredMaterial): NotesMaterialSummary {
  return {
    id: stored.id,
    noteId: stored.noteId,
    kind: stored.kind,
    text: stored.text,
    hasImage: stored.image !== null,
    submitted: stored.messageIds.length > 0,
    source: { ...stored.source },
    action: stored.action,
    order: stored.order,
    status: stored.status,
    error: stored.error,
    createdAt: stored.createdAt,
    archivedAt: stored.archivedAt,
  }
}

/** A successful operation result. */
function success<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value }
}

/** A refused operation result. */
function rejected<E extends NotesFailure>(error: E): NotesRejected<E> {
  return { ok: false, error }
}

export default NotesRemote
