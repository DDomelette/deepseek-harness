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
import type { AgentSetup } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { NoteSessionRecord } from './domain.ts'
import type { NotesSettings } from './settings.ts'
import type { NoteSessionId } from './types.ts'

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
    const presets = this.ctx.get('agentPresets')
    const presetId = presets === undefined ? undefined : (await presets.resolve()).id
    const setup: AgentSetup | undefined = presets === undefined || presetId === undefined
      ? undefined
      : async (agentCtx: Context): Promise<void> => { await presets.mount(agentCtx, presetId) }
    const model = this.settings.model()
    const sessionId = brandString<SessionId>(randomUUID())
    const handle = await this.ctx.agents.create({
      sessionId,
      meta: { cwd, ...presetId === undefined ? {} : { agentPreset: presetId } },
      ...model === null ? {} : { agentOptions: { provider: model.provider, model: model.model } },
      ...setup === undefined ? {} : { setup },
    })
    try {
      return await this.record({
        sessionId,
        title: this.defaultTitle(cwd),
        createdAt: Date.now(),
        archivedAt: null,
      })
    } catch (error) {
      await handle.dispose()
      throw error
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
   * The default display title: the notes prefix, the workspace's own name, and
   * a running number. The number counts every recorded conversation, archived
   * ones included, so a title is never reused.
   * @param cwd - the conversation workspace.
   * @returns the display title.
   */
  private defaultTitle(cwd: string): string {
    const name = cwd.split(/[\\/]/).filter(segment => segment.length > 0).pop() ?? cwd
    return `笔记 · ${name} ${String(this.table.size + 1)}`
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
