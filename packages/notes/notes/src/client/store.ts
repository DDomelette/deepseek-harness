/**
 * The panel's state: the conversations the Host reported, the materials of the
 * one it shows, and whether the last read is still in flight.
 *
 * The Host owns all of it; the store exists because a tab's body unmounts when
 * the reader switches away, and coming back must not re-read what it already
 * showed. Bucketed implicitly: the slot runtime mints one instance per session.
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type {
  NotesMaterialListValue, NotesMaterialSummary, NotesSessionListValue, NotesSessionSummary,
  NoteSessionId,
} from '../types.ts'
import type { NotesPanelFailure } from './failure-line.ts'

/** Everything the panel shows. */
export interface NotesState {
  /** Listed conversations, newest first. */
  sessions: readonly NotesSessionSummary[]
  /** Archived conversations, most recently archived first. */
  archived: readonly NotesSessionSummary[]
  /** Conversation the panel shows, or null when none exists yet. */
  activeId: NoteSessionId | null
  /** Listed materials of the active conversation, top-most first. */
  materials: readonly NotesMaterialSummary[]
  /** Archived materials of the active conversation. */
  archivedMaterials: readonly NotesMaterialSummary[]
  /** A read is in flight. */
  loading: boolean
  /** The Host answered at least once, so a remount has something to show. */
  loaded: boolean
  /** Why the last read produced nothing; cleared by the next read. */
  failure: NotesPanelFailure | undefined
}

/** The store's write set; every action is one step of one read. */
type NotesActions = {
  started: (draft: NotesState) => void
  failed: (draft: NotesState, failure: NotesPanelFailure) => void
  loaded: (
    draft: NotesState,
    sessions: NotesSessionListValue,
    materials: NotesMaterialListValue | null,
  ) => void
}

/**
 * Declare the panel's store.
 * @returns the store handle the tab registration declares.
 */
export function createNotesStore(): EngineStoreHandle<NotesState, NotesActions> {
  return defineStore({
    init: (): NotesState => ({
      sessions: [],
      archived: [],
      activeId: null,
      materials: [],
      archivedMaterials: [],
      loading: false,
      loaded: false,
      failure: undefined,
    }),
    actions: {
      /** @param d - draft state. */
      started: (d) => {
        d.loading = true
        d.failure = undefined
      },
      /** @param d - draft state. @param failure - the settled failure. */
      failed: (d, failure) => {
        d.loading = false
        d.failure = failure
      },
      /**
       * Record one complete read.
       * @param d - draft state.
       * @param sessions - the conversations the Host listed.
       * @param materials - the active conversation's materials, or null when
       *   there is no conversation to read them from.
       */
      loaded: (d, sessions, materials) => {
        d.sessions = sessions.sessions
        d.archived = sessions.archived
        d.activeId = sessions.activeId
        d.materials = materials?.materials ?? []
        d.archivedMaterials = materials?.archived ?? []
        d.loading = false
        d.loaded = true
        d.failure = undefined
      },
    },
  })
}

/** The store handle type the tab registration and the panel component name. */
export type NotesStore = ReturnType<typeof createNotesStore>
