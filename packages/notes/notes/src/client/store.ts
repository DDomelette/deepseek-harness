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
  MaterialId, NotesMaterialListValue, NotesMaterialSummary, NotesSessionListValue,
  NotesSessionSummary, NotesSettingsView, NotesThreadRow, NoteSessionId,
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
  /** Material whose detail is open, or null while the list alone is shown. */
  selected: MaterialId | null
  /** The selected material's thread, in sequence order. */
  thread: readonly NotesThreadRow[]
  /** The thread read is in flight. */
  threadLoading: boolean
  /** Why the last thread read produced nothing. */
  threadFailure: NotesPanelFailure | undefined
  /** A read is in flight. */
  loading: boolean
  /** The Host answered at least once, so a remount has something to show. */
  loaded: boolean
  /** Why the last read produced nothing; cleared by the next read. */
  failure: NotesPanelFailure | undefined
  /** Why the last write was refused; the panel's content stays under it. */
  notice: NotesPanelFailure | undefined
  /** The notes settings section, once the card has read it. */
  settings: NotesSettingsView | undefined
  /** A settings read is in flight. */
  settingsLoading: boolean
  /** Why the last settings read or write produced nothing. */
  settingsFailure: NotesPanelFailure | undefined
}

/** The store's write set; every action is one step of one read or write. */
type NotesActions = {
  started: (draft: NotesState) => void
  failed: (draft: NotesState, failure: NotesPanelFailure) => void
  loaded: (
    draft: NotesState,
    sessions: NotesSessionListValue,
    materials: NotesMaterialListValue | null,
  ) => void
  refused: (draft: NotesState, failure: NotesPanelFailure) => void
  selected: (draft: NotesState, id: MaterialId | null) => void
  threadStarted: (draft: NotesState) => void
  threadFailed: (draft: NotesState, failure: NotesPanelFailure) => void
  threadLoaded: (draft: NotesState, rows: readonly NotesThreadRow[]) => void
  settingsStarted: (draft: NotesState) => void
  settingsFailed: (draft: NotesState, failure: NotesPanelFailure) => void
  settingsLoaded: (draft: NotesState, settings: NotesSettingsView) => void
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
      selected: null,
      thread: [],
      threadLoading: false,
      threadFailure: undefined,
      loading: false,
      loaded: false,
      failure: undefined,
      notice: undefined,
      settings: undefined,
      settingsLoading: false,
      settingsFailure: undefined,
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
       * Record one complete read. A material the Host no longer lists closes its
       * detail, so the panel never shows a row that is gone.
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
        d.notice = undefined
        if (d.selected !== null && !d.materials.some(row => row.id === d.selected)) {
          d.selected = null
          d.thread = []
          d.threadFailure = undefined
        }
      },
      /** @param d - draft state. @param failure - the refusal the last write reported. */
      refused: (d, failure) => {
        d.notice = failure
      },
      /** @param d - draft state. @param id - the material to open, or null to close the detail. */
      selected: (d, id) => {
        d.selected = id
        d.thread = []
        d.threadFailure = undefined
      },
      /** @param d - draft state. */
      threadStarted: (d) => {
        d.threadLoading = true
        d.threadFailure = undefined
      },
      /** @param d - draft state. @param failure - the settled failure. */
      threadFailed: (d, failure) => {
        d.threadLoading = false
        d.threadFailure = failure
      },
      /** @param d - draft state. @param rows - the thread the Host returned. */
      threadLoaded: (d, rows) => {
        d.thread = rows
        d.threadLoading = false
        d.threadFailure = undefined
      },
      /** @param d - draft state. */
      settingsStarted: (d) => {
        d.settingsLoading = true
        d.settingsFailure = undefined
      },
      /** @param d - draft state. @param failure - the settled failure. */
      settingsFailed: (d, failure) => {
        d.settingsLoading = false
        d.settingsFailure = failure
      },
      /** @param d - draft state. @param settings - the section the Host returned. */
      settingsLoaded: (d, settings) => {
        d.settings = settings
        d.settingsLoading = false
        d.settingsFailure = undefined
      },
    },
  })
}

/** The store handle type the tab registration and the panel component name. */
export type NotesStore = ReturnType<typeof createNotesStore>
