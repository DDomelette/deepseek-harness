/**
 * What the panel can ask for, and what it does with the answer.
 *
 * The commands live here rather than in the component so the component only
 * renders: it calls a command on mount or on a click, and reads the store the
 * command writes. The Host calls arrive through a narrowed face, so a test
 * drives the panel without a gateway.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { FloatRect, PaneId, TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker/types'
import type {
  MaterialId, MaterialSource, NoteSessionId, NotesApplied, NotesFailure,
  NotesImageMediaType, NotesMaterialAddImageRequest, NotesMaterialAddImageResult,
  NotesMaterialAddResult, NotesMaterialAddTextRequest, NotesMaterialAnalyzeRequest,
  NotesMaterialAnalyzeResult, NotesMaterialArchiveRequest, NotesMaterialArchiveResult,
  NotesMaterialAskRequest, NotesMaterialAskResult, NotesMaterialListRequest,
  NotesMaterialListResult, NotesMaterialListValue, NotesMaterialRemoveRequest,
  NotesMaterialRemoveResult, NotesMaterialRenameRequest, NotesMaterialRenameResult,
  NotesMaterialReorderRequest, NotesMaterialReorderResult,
  NotesMaterialRestoreRequest, NotesMaterialRestoreResult, NotesMaterialThreadRequest,
  NotesMaterialThreadResult, NotesMaterialUpdateRequest, NotesMaterialUpdateResult, NotesRejected,
  NotesSessionArchiveRequest, NotesSessionArchiveResult, NotesSessionCreateResult,
  NotesSessionListResult, NotesSessionRestoreRequest, NotesSessionRestoreResult,
  NotesSessionSelectRequest, NotesSessionSelectResult, NotesSettingsReadResult,
  NotesSettingsUpdateRequest, NotesSettingsUpdateResult, NotesSuccess,
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
   * Collect one text material into a conversation.
   * @param request - the conversation, body, source, and action.
   * @returns the carrier result carrying the new material's id.
   */
  materialAddText(request: NotesMaterialAddTextRequest): Promise<RemoteResult<NotesMaterialAddResult>>
  /**
   * Collect one screenshot into a conversation.
   * @param request - the conversation, image bytes, media type, source, and action.
   * @returns the carrier result carrying the new material's id.
   */
  materialAddImage(request: NotesMaterialAddImageRequest): Promise<RemoteResult<NotesMaterialAddImageResult>>
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
   * Set one material's reader-set title.
   * @param request - the material and its new title; blank returns to the derived one.
   * @returns the carrier result carrying the acknowledgment or the refusal.
   */
  materialRename(request: NotesMaterialRenameRequest): Promise<RemoteResult<NotesMaterialRenameResult>>
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
  /**
   * The notes settings section as this deployment resolves it.
   * @returns the carrier result carrying the settings or the refusal.
   */
  settingsRead(): Promise<RemoteResult<NotesSettingsReadResult>>
  /**
   * Write the fields one settings patch names.
   * @param request - the fields to change.
   * @returns the carrier result carrying the acknowledgment or the refusal.
   */
  settingsUpdate(request: NotesSettingsUpdateRequest): Promise<RemoteResult<NotesSettingsUpdateResult>>
}

/** The frame operations one tab may ask for. */
export interface NotesPaneFace {
  /**
   * Take the tab out into a floating panel.
   * @param tabId - the tab to float.
   * @param rect - the panel's rectangle in viewport coordinates; defaults to the frame's cascade.
   */
  float(tabId: TabId, rect?: FloatRect): void
  /**
   * Return a floating panel's tab to the docked column.
   * @param paneId - the floating pane.
   */
  dock(paneId: PaneId): void
}

/** The size a floated notes window opens at, and its distance from the viewport's edges. */
const FLOAT_OPEN = { width: 640, height: 480, margin: 24 } as const

/**
 * The rectangle a floated notes window opens at: its own size clamped to the
 * viewport, against the right edge the docked column just left and centered
 * vertically. The dockkit cascade default (380×300 at the top-left) is smaller
 * than the panel's two-column layout and lands over the left sidebar.
 * @param viewport - the browser viewport's size in CSS pixels.
 * @returns the opening rectangle in viewport coordinates.
 */
export function notesFloatRect(viewport: { readonly width: number; readonly height: number }): FloatRect {
  const width = Math.min(FLOAT_OPEN.width, viewport.width - FLOAT_OPEN.margin * 2)
  const height = Math.min(FLOAT_OPEN.height, viewport.height - FLOAT_OPEN.margin * 2)
  return {
    x: viewport.width - width - FLOAT_OPEN.margin,
    y: (viewport.height - height) / 2,
    width,
    height,
  }
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
  /** Set one material's reader-set title; blank returns to the derived one. */
  readonly rename: (id: MaterialId, title: string) => void
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
  /** Move the panel between its docked and floating presentations; the window opens at `notesFloatRect`. */
  readonly present: (tab: TabId, pane: PaneId, floating: boolean) => void
  /** Read the notes settings section once, for the settings card. */
  readonly readSettings: () => void
  /** Write the fields one settings patch names. */
  readonly saveSettings: (patch: NotesSettingsUpdateRequest) => void
  /**
   * Ask the host to open its own directory chooser for the notes directory field.
   * @returns what the request answered: a chosen path, a cancelled chooser, or a
   *   deployment whose picker serves no native chooser.
   */
  readonly pickDirectory: () => Promise<NotesPickResult>
  /**
   * List one directory level for the in-card browser a deployment without a
   * native chooser needs.
   * @param path - the absolute directory to list, or null for the host's home.
   * @returns the level, or null when the host refused the listing.
   */
  readonly listDirectories: (path: string | null) => Promise<DirectoryListing | null>
  /**
   * Create one child directory under the level the in-card browser stands in.
   * @param path - the absolute parent directory.
   * @param name - the new folder's name, as typed.
   * @returns the created directory's path, or the refusal the host reported.
   */
  readonly createDirectory: (path: string, name: string) => Promise<NotesCreateDirectoryResult>
  /**
   * Read the deployment's model catalog for the settings card's pickers.
   * @returns the catalog, or null when the host refused the read.
   */
  readonly loadModels: () => Promise<ModelCatalog | null>
  /**
   * Add one collected passage to the notes, under an optional collection action.
   * @param text - the passage as collected.
   * @param action - the collection action, or null for a plain collection.
   * @param source - where the passage came from.
   * @returns the refusal that stopped the collection, or null when it landed.
   */
  readonly collect: (
    text: string,
    action: string | null,
    source: MaterialSource,
  ) => Promise<NotesPanelFailure | null>
  /**
   * Add one screenshot to the notes.
   * @param data - canonical base64 of the image bytes.
   * @param mediaType - the media type the bytes carry.
   * @param source - where the image came from.
   * @param action - the collection action, or null for a plain collection.
   * @returns the refusal that stopped the collection, or null when it landed.
   */
  readonly addImage: (
    data: string,
    mediaType: NotesImageMediaType,
    source: MaterialSource,
    action: string | null,
  ) => Promise<NotesPanelFailure | null>
  /** Delete one material record and close its detail. */
  readonly remove: (id: MaterialId) => void
}

/**
 * The panel's commands plus its own reactive facts.
 *
 * The Host settles a material on its own clock, so no command the panel calls
 * returns its answer: the tab registration publishes the settlement count as an
 * observable the renderer binds to `useNotesSettled`, and the panel reads the
 * conversations again whenever it moves.
 */
export interface NotesPanelInjected extends NotesInjected {
  hooks: {
    /** Settlements the Host has forwarded to this page. */
    notesSettled: SnapshotStore<number>
  }
}

/** One carrier failure as the panel reports it. */
function unavailable(error: { readonly message: string }): NotesPanelFailure {
  return { code: 'remote-unavailable', message: error.message }
}

/** What every valueless write resolves to. */
type AppliedResult = NotesSuccess<NotesApplied> | NotesRejected<NotesFailure>

/**
 * The directory-picking namespace, as this panel calls it.
 *
 * The panel reaches the host's own chooser over the wire instead of importing
 * another feature plugin: `pick` is the operation the workspace flow uses and
 * refuses on a deployment that serves no native chooser, and `list` is the
 * browse primitive that deployment does serve, which the card draws as its own
 * browser.
 */
export interface NotesDirectoryFace {
  /**
   * Open the host's chooser.
   * @returns the chosen absolute path, or null when the operator cancels.
   */
  pick(): Promise<RemoteResult<string | null>>
  /**
   * List one directory level.
   * @param path - absolute directory to list; absent lists the home directory.
   * @returns the level's child directories and its ancestry.
   */
  list(path: string | undefined): Promise<RemoteResult<DirectoryListing>>
  /**
   * Create one child directory under an existing parent.
   * @param path - the absolute parent directory.
   * @param name - a single path segment.
   * @returns the created directory's absolute path.
   */
  createDirectory(path: string, name: string): Promise<RemoteResult<string>>
}

/** What one directory-chooser request answered. */
export type NotesPickResult =
  | { readonly kind: 'picked'; readonly path: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unavailable' }

/**
 * What one new-folder request answered: the created directory's path, or the
 * refusal the host reported, narrowed to the two outcomes the browser draws —
 * a name that already exists, and everything else.
 */
export type NotesCreateDirectoryResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly code: 'exists' | 'failed' }

/**
 * The session namespace, as this panel reads one deployment fact from it.
 *
 * The model catalog is the same Host-generation answer the conversation's own
 * model picker renders, so the notes section names a route the deployment
 * actually serves instead of holding a second copy of what is configured.
 */
export interface NotesSessionFace {
  /**
   * Read the models this deployment can route a request to.
   * @returns the catalog, with its provider groups and each model's efforts.
   */
  modelCatalog(): Promise<RemoteResult<ModelCatalog>>
}

/**
 * Build the panel's commands over one store instance.
 * @param remote - the notes namespace of the Client Remote face.
 * @param directoryPicker - the host's directory-picking namespace.
 * @param session - the session namespace carrying the model catalog.
 * @param frame - the right column's operations the tab may ask for.
 * @param actions - the store actions of the instance the panel is registered with.
 * @returns the commands the panel calls.
 */
export function notesFace(
  remote: NotesRemoteFace,
  directoryPicker: NotesDirectoryFace,
  session: NotesSessionFace,
  frame: NotesPaneFace,
  actions: BoundActions<NotesStore>,
): NotesInjected {
  let reading: Promise<void> | undefined
  let refreshRevision = 0
  let answered = false
  let open: MaterialId | null = null
  let threadRevision = 0
  let shown: NoteSessionId | null = null
  let settingsReading = false
  let settingsAnswered = false

  /**
   * Read the conversations, then the shown conversation's materials.
   * @param force - read again even though an earlier read already answered.
   */
  function read(force: boolean): Promise<void> {
    if (reading !== undefined) {
      if (force) refreshRevision += 1
      return reading
    }
    if (answered && !force) return Promise.resolve()
    reading = drain()
    return reading
  }

  /** Drain invalidations that arrive while the current listing is pending. */
  async function drain(): Promise<void> {
    try {
      let revision: number
      do {
        revision = refreshRevision
        await readOnce()
      } while (revision !== refreshRevision)
    } finally {
      reading = undefined
    }
  }

  /** Read one conversation listing and its active material buckets. */
  async function readOnce(): Promise<void> {
    actions.started()
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
  }

  return {
    load: () => {
      void read(false)
    },
    refresh: () => {
      void refreshAll()
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
    rename: (id, title) => {
      void write(async () => await remote.materialRename({ id, title }))
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
    present: (tab, pane, floating) => {
      if (floating) frame.dock(pane)
      else frame.float(tab, notesFloatRect({ width: window.innerWidth, height: window.innerHeight }))
    },
    readSettings: () => {
      void readSettings(false)
    },
    saveSettings: (patch) => {
      void (async () => {
        const answer = await remote.settingsUpdate(patch)
        if (!answer.ok) {
          actions.settingsFailed(unavailable(answer.error))
          return
        }
        if (!answer.value.ok) {
          actions.settingsFailed(answer.value.error)
          return
        }
        await readSettings(true)
      })()
    },
    pickDirectory: async () => {
      const picked = await directoryPicker.pick()
      // A refused pick is a deployment that composes the browse primitives
      // instead of a native chooser, not a failure: the card draws its browser.
      if (!picked.ok) return { kind: 'unavailable' }
      return picked.value === null ? { kind: 'cancelled' } : { kind: 'picked', path: picked.value }
    },
    listDirectories: async (path) => {
      const listed = await directoryPicker.list(path ?? undefined)
      if (!listed.ok) {
        actions.settingsFailed({ code: 'directory-unavailable' })
        return null
      }
      return listed.value
    },
    createDirectory: async (path, name) => {
      const created = await directoryPicker.createDirectory(path, name)
      if (!created.ok) {
        return {
          ok: false,
          // The wire vocabulary is the controller's; only a name conflict gets
          // its own line in the browser, everything else is one failure.
          code: created.error.code === 'directory-picker/exists' ? 'exists' : 'failed',
        }
      }
      return { ok: true, path: created.value }
    },
    loadModels: async () => {
      const catalog = await session.modelCatalog()
      if (!catalog.ok) {
        actions.settingsFailed({ code: 'settings-unavailable' })
        return null
      }
      return catalog.value
    },
    collect: async (text, action, source) => {
      const target = await collectTarget()
      if (!target.ok) return target.failure
      const added = await remote.materialAddText({ noteId: target.id, text, source, action })
      if (!added.ok) return unavailable(added.error)
      if (!added.value.ok) return added.value.error
      await read(true)
      return null
    },
    addImage: async (data, mediaType, source, action) => {
      const target = await collectTarget()
      if (!target.ok) return target.failure
      const added = await remote.materialAddImage({ noteId: target.id, data, mediaType, source, action })
      if (!added.ok) return unavailable(added.error)
      if (!added.value.ok) return added.value.error
      await read(true)
      return null
    },
    remove: (id) => {
      close()
      void write(async () => await remote.materialRemove({ id }))
    },
  }

  /**
   * The conversation a collection lands in: the one the Host shows, or a new
   * one when the deployment has none yet. The panel and the collecting surface
   * share one namespace but not one store, so this is read here rather than
   * assumed from whatever either last showed.
   */
  async function collectTarget(): Promise<
    { readonly ok: true; readonly id: NoteSessionId } | { readonly ok: false; readonly failure: NotesPanelFailure }
  > {
    const listed = await remote.sessionList()
    if (!listed.ok) return { ok: false, failure: unavailable(listed.error) }
    const active = listed.value.value.activeId
    if (active !== null) return { ok: true, id: active }
    const created = await remote.sessionCreate()
    if (!created.ok) return { ok: false, failure: unavailable(created.error) }
    if (!created.value.ok) return { ok: false, failure: created.value.error }
    return { ok: true, id: created.value.value.id }
  }

  /**
   * Read the notes settings section into the card's state.
   * @param force - read again even though an earlier read already answered.
   */
  async function readSettings(force: boolean): Promise<void> {
    if (settingsReading || (settingsAnswered && !force)) return
    settingsReading = true
    actions.settingsStarted()
    try {
      const answer = await remote.settingsRead()
      if (!answer.ok) {
        actions.settingsFailed(unavailable(answer.error))
        return
      }
      if (!answer.value.ok) {
        actions.settingsFailed(answer.value.error)
        return
      }
      settingsAnswered = true
      actions.settingsLoaded(answer.value.value)
    } finally {
      settingsReading = false
    }
  }

  /** Read one material's thread, into the detail the panel has open for it. */
  async function readThread(id: MaterialId): Promise<void> {
    const revision = ++threadRevision
    actions.threadStarted()
    const answer = await remote.materialThread({ id })
    // A newer read owns the detail even when it asks for the same material.
    if (open !== id || revision !== threadRevision) return
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
   * Read everything the panel shows: the conversations, the shown
   * conversation's materials, and the thread of the detail that is open.
   */
  async function refreshAll(): Promise<void> {
    await read(true)
    if (open !== null) await readThread(open)
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
