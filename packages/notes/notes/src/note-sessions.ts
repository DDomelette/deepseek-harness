/**
 * Notes conversations: one record per real dsh Session the panel drives.
 *
 * The dsh Session is the truth; this record adds only what the panel needs — a
 * title, when it was created, and whether it is archived. The active pointer
 * lives in the domain global so a restart reopens the same conversation.
 *
 * A restored conversation keeps its creation position rather than jumping to
 * the top: the list is ordered by creation instant, and the record carries no
 * separate order value.
 * @module @deepseek-ai/dsh-notes/note-sessions
 */

import { randomUUID } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentSetup } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-session-title'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { Workspace, WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import type { NoteSessionRecord } from './domain.ts'
import type { NotesSettings } from './settings.ts'
import type { NoteSessionId } from './types.ts'

/** The notes prefix every generated conversation title carries. */
const NOTES_TITLE_PREFIX = '笔记 · '

/**
 * The display title this plugin gives a workspace it registers itself. A
 * directory the reader already registered keeps its own title: the session list
 * groups by workspace, and renaming one of theirs would move their other
 * conversations.
 */
const NOTES_WORKSPACE_TITLE = '笔记'

/** A stored notes conversation together with its id. */
export type StoredNoteSession = NoteSessionRecord & { readonly id: NoteSessionId }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable notes-conversation records. */
    notesSessions: NoteSessions
  }
}

/** Durable notes-conversation records. */
export class NoteSessions extends Service {
  static inject = ['notesStore', 'agents', 'notesSettings']

  /** @param ctx - host context carrying the open notes domain and the agent registry. */
  constructor(ctx: Context) {
    super(ctx, 'notesSessions')
  }

  private get table(): KvTable<NoteSessionId, NoteSessionRecord> {
    return this.ctx.notesStore.sessions
  }

  private get settings(): NotesSettings {
    return this.ctx.notesSettings
  }

  /**
   * Start a new notes conversation: a real dsh Session over the configured
   * workspace and model, recorded and made active.
   *
   * The conversation's route is the notes model override when the settings carry
   * one, and the deployment's default model selection otherwise — the same
   * default every other entry point reads at creation time, so a conversation
   * created here is routed like one created anywhere else. A deployment with
   * neither leaves the route to the request waterfall.
   *
   * A deployment whose row owns a preset roster mounts the default preset into
   * the new Session, so its tools and prompt sections match every other Session
   * the deployment starts. Without a roster the model-facing rows live on the
   * host plane, and the registry reads them from the global layer.
   *
   * Agent lifetime belongs to this service's fiber through the creation
   * context, so an unmount disposes every conversation it started; a failed
   * record disposes the just-created agent rather than leaving it running
   * without a record.
   * @returns the recorded conversation id.
   * @throws {Error} when no workspace is configured, or creation or recording fails.
   */
  async create(): Promise<NoteSessionId> {
    const cwd = this.requireWorkspace()
    const workspace = await this.ensureWorkspaceRecord(cwd)
    const presets = this.ctx.get('agentPresets')
    const presetId = presets === undefined ? undefined : (await presets.resolve()).id
    const setup: AgentSetup | undefined = presets === undefined || presetId === undefined
      ? undefined
      : async (agentCtx: Context): Promise<void> => { await presets.mount(agentCtx, presetId) }
    const model = this.settings.model()
    const route = model ?? this.ctx.get('agentDefaultModel')?.currentSelection()
    const sessionId = brandString<SessionId>(randomUUID())
    const title = this.defaultTitle()
    const handle = await this.ctx.agents.create({
      sessionId,
      meta: { cwd, ...presetId === undefined ? {} : { agentPreset: presetId } },
      ...route === undefined ? {} : { agentOptions: { provider: route.provider, model: route.model } },
      ...setup === undefined ? {} : { setup },
    })
    this.titleSession(handle.agent, title)
    await this.joinWorkspace(workspace, sessionId)
    try {
      return await this.record({
        sessionId,
        title,
        createdAt: Date.now(),
        archivedAt: null,
      })
    } catch (error) {
      await handle.dispose()
      throw error
    }
  }

  /**
   * Whether a notes conversation can be started at all: a dsh Session has no
   * workspace of its own, so the notes settings must name one.
   * @returns true when a workspace is configured.
   */
  hasWorkspace(): boolean {
    return this.settings.workspace() !== null
  }

  /**
   * Make the notes directory a workspace the session list can group by.
   *
   * A dsh Session appears under a registered workspace, and a directory nothing
   * registered lands among the reader's ungrouped sessions, where the notes
   * conversations would be scattered through unrelated work. The registry keeps
   * an existing record's title, so a directory the reader registered keeps the
   * name they gave it; a directory this plugin registers is titled `笔记`.
   * @param cwd - the configured notes directory.
   * @returns the workspace owning the directory, or undefined when the
   *   deployment serves no registry or the directory cannot be one.
   */
  private async ensureWorkspaceRecord(cwd: string): Promise<Workspace | undefined> {
    const registry: WorkspaceRegistry | undefined = this.ctx.get('workspaceRegistry')
    if (registry === undefined) return undefined
    try {
      return await registry.create(cwd, NOTES_WORKSPACE_TITLE)
    } catch {
      // The registry owns only directories that exist, and grouping is a
      // convenience: a directory it cannot own must not stop the conversation
      // the reader asked for. That conversation keeps its cwd and is listed as
      // ungrouped, which is what a deployment without this registry does too.
      return undefined
    }
  }

  /**
   * Put the conversation on its workspace's account.
   *
   * A workspace lists the Sessions it accounts for rather than every Session
   * under its directory, so the record alone leaves the conversation ungrouped.
   * The registry validates the Session's stored header cwd against the
   * directory, which is why this runs once the conversation exists.
   * @param workspace - the notes directory's workspace, when there is one.
   * @param sessionId - the conversation's Session.
   */
  private async joinWorkspace(workspace: Workspace | undefined, sessionId: SessionId): Promise<void> {
    if (workspace === undefined) return
    try {
      await workspace.attachSession(sessionId)
    } catch {
      // The registry refuses a Session whose header cwd it cannot validate
      // against the directory. Accounting is a convenience like the record
      // itself, so the conversation the reader asked for still starts; it is
      // listed as ungrouped until the directory is registered again.
    }
  }

  /**
   * Name the conversation where the session list shows it.
   *
   * A session-list row carries the Session's own durable title and falls back
   * to the workspace directory's name, which for a notes directory is a path
   * segment the reader never chose. The explicit title also pins the Session:
   * automatic generation would otherwise retitle it from a message the reader
   * types into the conversation later, and the panel's own chip would stop
   * matching the row.
   * @param agent - the live agent of the conversation just started.
   * @param title - the display title to record.
   */
  private titleSession(agent: Agent, title: string): void {
    const titles = this.ctx.get('sessionTitle')
    if (titles === undefined) return
    try {
      titles.rename(agent.session, title)
    } catch {
      // The service refuses a blank title, a Session its store does not hold
      // live, and a disposed service. A name is not worth failing the
      // conversation the reader asked for; the row keeps its fallback label.
    }
  }

  /** The configured conversation workspace. */
  private requireWorkspace(): string {
    const cwd = this.settings.workspace()
    if (cwd === null) {
      throw new Error(
        'notes: no workspace is configured; set the notes workspace before creating a conversation',
      )
    }
    return cwd
  }

  /**
   * The default display title: the notes prefix and a running two-digit number.
   * The number counts every recorded conversation, archived ones included, so a
   * title is never reused and the reader cannot confuse two of them.
   * @returns the display title.
   */
  private defaultTitle(): string {
    return `${NOTES_TITLE_PREFIX}${String(this.table.size).padStart(2, '0')}`
  }

  /**
   * Unarchived conversations, newest first.
   * @returns the ordered conversations.
   */
  list(): StoredNoteSession[] {
    return this.collect(null)
  }

  /**
   * Archived conversations, most recently archived first.
   * @returns the ordered archived conversations.
   */
  archived(): StoredNoteSession[] {
    const rows = this.collect('archived')
    // The archived filter admits only stamped records, so Number() never sees
    // the null a `?? 0` fallback would have to cover.
    return rows.sort((left, right) =>
      Number(right.archivedAt) - Number(left.archivedAt))
  }

  private collect(bucket: 'archived' | null): StoredNoteSession[] {
    const rows: StoredNoteSession[] = []
    for (const [id, record] of this.table.entries()) {
      if (bucket === null ? record.archivedAt !== null : record.archivedAt === null) continue
      rows.push({ ...record, id })
    }
    return rows.sort((left, right) => right.createdAt - left.createdAt)
  }

  /**
   * Read one conversation by id.
   * @param id - conversation id.
   * @returns the stored conversation, or undefined when absent.
   */
  get(id: NoteSessionId): StoredNoteSession | undefined {
    const record = this.table.get(id)
    return record === undefined ? undefined : { ...record, id }
  }

  /**
   * Record one conversation and make it active.
   * @param record - the complete record.
   * @returns the minted conversation id.
   */
  async record(record: NoteSessionRecord): Promise<NoteSessionId> {
    const id = brandString<NoteSessionId>(randomUUID())
    await this.table.put(id, record)
    await this.setActive(id)
    return id
  }

  /**
   * Whether one conversation may be archived. The last unarchived conversation
   * cannot be: the panel always owns one conversation to show.
   * @param id - conversation id.
   * @returns true when archiving `id` would leave another conversation listed.
   */
  canArchive(id: NoteSessionId): boolean {
    return this.list().some(row => row.id !== id)
  }

  /**
   * Move one conversation to the archived bucket, moving the active pointer to
   * the newest remaining conversation when it pointed at the archived one.
   *
   * The last unarchived conversation cannot be archived: the panel always owns
   * one conversation to show, and the browser half must not be the only thing
   * enforcing that (a direct caller would bypass a hidden button).
   * @param id - conversation id.
   * @throws {Error} when `id` is the last unarchived conversation.
   */
  async archive(id: NoteSessionId): Promise<void> {
    const [next] = this.list().filter(row => row.id !== id)
    if (next === undefined) {
      throw new Error('notes: the last notes conversation cannot be archived')
    }
    await this.table.update(id, record => ({ ...record, archivedAt: Date.now() }))
    if (this.active() !== id) return
    await this.setActive(next.id)
  }

  /**
   * Return one archived conversation to the list and make it active.
   * @param id - conversation id.
   */
  async restore(id: NoteSessionId): Promise<void> {
    await this.table.update(id, record => ({ ...record, archivedAt: null }))
    await this.setActive(id)
  }

  /**
   * Read the active conversation.
   * @returns the active conversation id, or null when none exists.
   */
  active(): NoteSessionId | null {
    return this.ctx.notesStore.activeNoteId()
  }

  /**
   * Point the panel at one conversation.
   * @param id - conversation id, or null for none.
   */
  async setActive(id: NoteSessionId | null): Promise<void> {
    await this.ctx.notesStore.setActiveNoteId(id)
  }
}

export default NoteSessions
