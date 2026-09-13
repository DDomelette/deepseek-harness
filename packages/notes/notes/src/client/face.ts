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
  NotesMaterialListRequest, NotesMaterialListResult, NotesMaterialListValue,
  NotesSessionCreateResult, NotesSessionListResult,
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
}

/** The commands the panel's body calls. */
export interface NotesInjected {
  /** Read once: a store that already holds an answer reads nothing. */
  readonly load: () => void
  /** Re-read everything, whatever the store already holds. */
  readonly refresh: () => void
  /** Start a conversation and show it. */
  readonly createConversation: () => void
}

/** One carrier failure as the panel reports it. */
function unavailable(error: { readonly message: string }): NotesPanelFailure {
  return { code: 'remote-unavailable', message: error.message }
}

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
  }
}
