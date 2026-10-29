/**
 * The notes domain owner: the one service that opens the notes domain and
 * hands its tables to every other consumer.
 *
 * `ctx.storageDomain.open` admits one open per domain name, so a second caller
 * would fail with `already-open`. Exactly one service therefore owns the open
 * and its close effect; the material store, the conversation records, and the
 * panel's active pointer all read the handles this service holds.
 * @module @deepseek-ai/dsh-notes/store
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { NOTES_TABLES, notesDomainSpec, openNotesDomain } from './domain.ts'
import type { MaterialRecord, NoteSessionRecord } from './domain.ts'
import type { MaterialId, NoteSessionId } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The open notes domain and the tables every notes consumer reads. */
    notesStore: NotesStore
  }
}

/** Owns the open notes domain and exposes its tables. */
export class NotesStore extends Service {
  static inject = ['storageDomain']

  private domain?: Domain<typeof notesDomainSpec>

  /** @param ctx - host context carrying the storage domain facility. */
  constructor(ctx: Context) {
    super(ctx, 'notesStore')
  }

  /**
   * Open the domain for this plugin's lifetime. The close effect runs when this
   * service's fiber disposes; cordis unloads sibling fibers concurrently, so no
   * consumer may rely on having finished its own teardown by then.
   */
  protected async [Service.init](): Promise<void> {
    this.domain = await openNotesDomain(this.ctx)
  }

  /**
   * The materials table.
   * @returns the table handle.
   */
  get materials(): KvTable<MaterialId, MaterialRecord> {
    return this.requireDomain().table(NOTES_TABLES.materials)
  }

  /**
   * The notes-conversation table.
   * @returns the table handle.
   */
  get sessions(): KvTable<NoteSessionId, NoteSessionRecord> {
    return this.requireDomain().table(NOTES_TABLES.sessions)
  }

  /**
   * The conversation the panel shows.
   * @returns the stored conversation id, or null when none exists yet.
   */
  activeNoteId(): NoteSessionId | null {
    return this.requireDomain().global.get().activeNoteId
  }

  /**
   * Point the panel at one conversation.
   * @param id - conversation id, or null for none.
   */
  async setActiveNoteId(id: NoteSessionId | null): Promise<void> {
    await this.requireDomain().global.set({ activeNoteId: id })
  }

  private requireDomain(): Domain<typeof notesDomainSpec> {
    if (this.domain === undefined) throw new Error('notes: the domain is not open yet')
    return this.domain
  }
}

export default NotesStore
