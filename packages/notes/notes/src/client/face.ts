/**
 * What the panel can ask for, and what it does with the answer.
 *
 * The commands live here rather than in the component so the component only
 * renders: it calls a command on mount or on a click, and reads the store the
 * command writes. The Host calls arrive through a narrowed face, so a test
 * drives the panel without a gateway.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  MaterialId, NoteSessionId, NotesApplied, NotesFailure, NotesMaterialAnalyzeRequest,
  NotesMaterialAnalyzeResult, NotesMaterialArchiveRequest, NotesMaterialArchiveResult,
  NotesMaterialAskRequest, NotesMaterialAskResult, NotesMaterialListRequest,
  NotesMaterialListResult, NotesMaterialListValue, NotesMaterialRemoveRequest,
  NotesMaterialRemoveResult, NotesMaterialReorderRequest, NotesMaterialReorderResult,
  NotesMaterialRestoreRequest, NotesMaterialRestoreResult, NotesMaterialThreadRequest,
  NotesMaterialThreadResult, NotesMaterialUpdateRequest, NotesMaterialUpdateResult, NotesRejected,
  NotesSessionArchiveRequest, NotesSessionArchiveResult, NotesSessionCreateResult,
  NotesSessionListResult, NotesSessionRestoreRequest, NotesSessionRestoreResult,
  NotesSessionSelectRequest, NotesSessionSelectResult, NotesSuccess,
} from '../types.ts'
import type { NotesPanelFailure } from './failure-line.ts'
import type { NotesStore } from './store.ts'

/** The Host operations this panel reads and writes through. */
export interface NotesRemoteFace {
  /**
   * Every recorded conversation plus the active pointer.
   * @returns the carrier result carrying the Host's answer.
   */
  sessionList(): Promise<RemoteResult<NotesSessionListResult>>
  /**
   * Start a conversation over the deployment's configured workspace and model.
   * @returns the carrier result carrying the new conversation's id.
   */
  sessionCreate(): Promise<RemoteResult<NotesSessionCreateResult>>
  /**
   * Both material buckets of one conversation.
   * @param request - the conversation to read.
   * @returns the carrier result carrying the materials.
   */
  materialList(request: NotesMaterialListRequest): Promise<RemoteResult<NotesMaterialListResult>>
  /**
   * One material's own thread.
   * @param request - the material whose thread to read.
   * @returns the carrier result carrying the rows.
   */
  materialThread(request: NotesMaterialThreadRequest): Promise<RemoteResult<NotesMaterialThreadResult>>
  /**
   * Replace one draft material's text.
   * @param request - the material and its replacement body.
   * @returns the carrier result carrying the acknowledgment or the refusal.
   */
  materialUpdate(request: NotesMaterialUpdateRequest): Promise<RemoteResult<NotesMaterialUpdateResult>>
  /**
   * Submit one material to its conversation.
   * @param request - the material to analyse.
   * @returns the carrier result carrying the acknowledgment or the refusal.
   */
  materialAnalyze(request: NotesMaterialAnalyzeRequest): Promise<RemoteResult<NotesMaterialAnalyzeResult>>
  /**
   * Ask a follow-up inside one material's thread.
   * @param request - the material and the question.
   * @returns the carrier result carrying the acknowledgment or the refusal.
   */
  materialAsk(request: NotesMaterialAskRequest): Promise<RemoteResult<NotesMaterialAskResult>>
  /**
   * Move one material to its conversation's archived bucket.
   * @param request - the material to archive.
   * @returns the carrier result carrying the acknowledgment or the refusal.
   */
  materialArchive(request: NotesMaterialArchiveRequest): Promise<RemoteResult<NotesMaterialArchiveResult>>
  /**
   * Return one archived material to the top of its conversation.
   * @param request - the material to restore.
   * @returns the carrier result carrying the acknowledgment or the refusal.
   */
  materialRestore(request: NotesMaterialRestoreRequest): Promise<RemoteResult<NotesMaterialRestoreResult>>
  /**
   * Apply a complete manual ordering to one conversation.
   * @param request - the conversation and its materials, top first.
   * @returns the carrier result carrying the acknowledgment or the refusal.
   */
  materialReorder(request: NotesMaterialReorderRequest): Promise<RemoteResult<NotesMaterialReorderResult>>
  /**
   * Delete one material record.
   * @param request - the material to delete.
   * @returns the carrier result carrying the acknowledgment or the refusal.
   */
  materialRemove(request: NotesMaterialRemoveRequest): Promise<RemoteResult<NotesMaterialRemoveResult>>
  /**
   * Point the panel at one conversation.
   * @param request - the conversation to show.
   * @returns the carrier result carrying the acknowledgment or the refusal.
   */
  sessionSelect(request: NotesSessionSelectRequest): Promise<RemoteResult<NotesSessionSelectResult>>
  /**
   * Archive one conversation, moving the active pointer when it pointed there.
   * @param request - the conversation to archive.
   * @returns the carrier result carrying the acknowledgment or the refusal.
   */
  sessionArchive(request: NotesSessionArchiveRequest): Promise<RemoteResult<NotesSessionArchiveResult>>
  /**
   * Return one archived conversation to the list and make it active.
   * @param request - the conversation to restore.
   * @returns the carrier result carrying the acknowledgment or the refusal.
   */
  sessionRestore(request: NotesSessionRestoreRequest): Promise<RemoteResult<NotesSessionRestoreResult>>
}

/** The commands the panel's body calls. */
export interface NotesInjected {
  /** Read once: a store that already holds an answer reads nothing. */
  readonly load: () => void
  /** Re-read everything, whatever the store already holds. */
  readonly refresh: () => void
  /** Start a conversation and show it. */
  readonly createConversation: () => void
  /** Show one listed conversation. */
  readonly openSession: (id: NoteSessionId) => void
  /** Archive one conversation. */
  readonly archiveSession: (id: NoteSessionId) => void
  /** Return one archived conversation to the list and show it. */
  readonly restoreSession: (id: NoteSessionId) => void
  /** Open one material's detail and read its thread, or close the detail with null. */
  readonly select: (id: MaterialId | null) => void
  /** Replace one draft material's text. */
  readonly saveText: (id: MaterialId, text: string) => void
  /** Submit one material to its conversation. */
  readonly analyze: (id: MaterialId) => void
  /** Ask a follow-up inside one material's thread. */
  readonly ask: (id: MaterialId, question: string) => void
  /** Move one material to the archived bucket and close its detail. */
  readonly archive: (id: MaterialId) => void
  /** Return one archived material to the top of its conversation. */
  readonly restore: (id: MaterialId) => void
  /** Apply a complete manual ordering to the shown conversation. */
  readonly reorder: (orderedIds: readonly MaterialId[]) => void
  /** Delete one material record and close its detail. */
  readonly remove: (id: MaterialId) => void
}

/** One carrier failure as the panel reports it. */
function unavailable(error: { readonly message: string }): NotesPanelFailure {
  return { code: 'remote-unavailable', message: error.message }
}

/** What every valueless write resolves to. */
type AppliedResult = NotesSuccess<NotesApplied> | NotesRejected<NotesFailure>

/**
 * Build the panel's commands over one store instance.
 * @param remote - the notes namespace of the Client Remote face.
 * @param actions - the store actions of the instance the panel is registered with.
 * @returns the commands the panel calls.
 */
export function notesFace(
  remote: NotesRemoteFace,
  actions: BoundActions<NotesStore>,
): NotesInjected {
  let reading = false
  let answered = false
  let open: MaterialId | null = null
  let shown: NoteSessionId | null = null

  /**
   * Read the conversations, then the shown conversation's materials.
   * @param force - read again even though an earlier read already answered.
   */
  async function read(force: boolean): Promise<void> {
    if (reading || (answered && !force)) return
    reading = true
    actions.started()
    try {
      const sessions = await remote.sessionList()
      if (!sessions.ok) {
        actions.failed(unavailable(sessions.error))
        return
      }
      const list = sessions.value.value
      let buckets: NotesMaterialListValue | null = null
      if (list.activeId !== null) {
        const answer = await remote.materialList({ noteId: list.activeId })
        if (!answer.ok) {
          actions.failed(unavailable(answer.error))
          return
        }
        if (!answer.value.ok) {
          actions.failed(answer.value.error)
          return
        }
        buckets = answer.value.value
      }
      answered = true
      shown = list.activeId
      actions.loaded(list, buckets)
    } finally {
      reading = false
    }
  }

  return {
    load: () => {
      void read(false)
    },
    refresh: () => {
      void read(true)
    },
    createConversation: () => {
      void (async () => {
        const created = await remote.sessionCreate()
        if (!created.ok) {
          actions.failed(unavailable(created.error))
          return
        }
        if (!created.value.ok) {
          actions.failed(created.value.error)
          return
        }
        await read(true)
      })()
    },
    openSession: (id) => {
      close()
      void write(async () => await remote.sessionSelect({ id }))
    },
    archiveSession: (id) => {
      close()
      void write(async () => await remote.sessionArchive({ id }))
    },
    restoreSession: (id) => {
      close()
      void write(async () => await remote.sessionRestore({ id }))
    },
    select: (id) => {
      open = id
      actions.selected(id)
      if (id !== null) void readThread(id)
    },
    saveText: (id, text) => {
      void write(async () => await remote.materialUpdate({ id, text }))
    },
    analyze: (id) => {
      void write(async () => await remote.materialAnalyze({ id }))
    },
    ask: (id, question) => {
      void write(async () => await remote.materialAsk({ id, question }))
    },
    archive: (id) => {
      close()
      void write(async () => await remote.materialArchive({ id }))
    },
    restore: (id) => {
      void write(async () => await remote.materialRestore({ id }))
    },
    reorder: (orderedIds) => {
      /* v8 ignore next -- a list offering a reorder was drawn from a listed conversation. */
      if (shown === null) return
      const noteId = shown
      void write(async () => await remote.materialReorder({ noteId, orderedIds }))
    },
    remove: (id) => {
      close()
      void write(async () => await remote.materialRemove({ id }))
    },
  }

  /** Read one material's thread, into the detail the panel has open for it. */
  async function readThread(id: MaterialId): Promise<void> {
    actions.threadStarted()
    const answer = await remote.materialThread({ id })
    if (!answer.ok) {
      actions.threadFailed(unavailable(answer.error))
      return
    }
    if (!answer.value.ok) {
      actions.threadFailed(answer.value.error)
      return
    }
    actions.threadLoaded(answer.value.value.rows)
  }

  /**
   * Run one write, report its refusal, and re-read every view of it when it
   * landed.
   * @param operation - the Host call to make.
   */
  async function write(operation: () => Promise<RemoteResult<AppliedResult>>): Promise<void> {
    const answer = await operation()
    if (!answer.ok) {
      actions.refused(unavailable(answer.error))
      return
    }
    if (!answer.value.ok) {
      actions.refused(answer.value.error)
      return
    }
    await read(true)
    if (open !== null) await readThread(open)
  }

  /** Forget the open detail, so its thread's answer cannot land in another material's. */
  function close(): void {
    open = null
    actions.selected(null)
  }
}
