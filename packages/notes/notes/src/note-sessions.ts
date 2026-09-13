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
import { brandString } from '@deepseek-ai/dsh-brand'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { NoteSessionRecord } from './domain.ts'
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
  static inject = ['notesStore']

  /** @param ctx - host context carrying the open notes domain. */
  constructor(ctx: Context) {
    super(ctx, 'notesSessions')
  }

  private get table(): KvTable<NoteSessionId, NoteSessionRecord> {
    return this.ctx.notesStore.sessions
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
