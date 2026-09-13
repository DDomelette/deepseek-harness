/**
 * Material storage: creation, ordering, archiving, and restore-to-top.
 *
 * Ordering is an explicit integer per material, rewritten wholesale by
 * `reorder`. A new material lands at the top because `create` mints an order
 * below every visible one, and `restore` does the same, so neither needs a
 * renumbering pass. Reads are synchronous snapshots of the domain's
 * authoritative in-memory state.
 * @module @deepseek-ai/dsh-notes/materials
 */

import { randomUUID } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { MaterialRecord } from './domain.ts'
import type { MaterialId, NoteSessionId } from './types.ts'

/** A stored material together with its id. */
export type StoredMaterial = MaterialRecord & { readonly id: MaterialId }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable material storage for the notes panel. */
    notesMaterials: Materials
  }
}

/** Durable material storage. */
export class Materials extends Service {
  static inject = ['notesStore']

  /** @param ctx - host context carrying the open notes domain. */
  constructor(ctx: Context) {
    super(ctx, 'notesMaterials')
  }

  private get table(): KvTable<MaterialId, MaterialRecord> {
    return this.ctx.notesStore.materials
  }

  /**
   * Visible materials of one conversation, top-most first.
   * @param noteId - notes conversation id.
   * @returns the ordered materials, archived ones excluded.
   */
  list(noteId: NoteSessionId): StoredMaterial[] {
    const visible = this.collect(noteId, null)
    return visible.sort((left, right) =>
      left.order - right.order || left.createdAt - right.createdAt)
  }

  /**
   * Archived materials of one conversation, most recently archived first.
   * @param noteId - notes conversation id.
   * @returns the ordered archived materials.
   */
  archived(noteId: NoteSessionId): StoredMaterial[] {
    const rows = this.collect(noteId, 'archived')
    // The archived filter admits only stamped records, so Number() never sees
    // the null a `?? 0` fallback would have to cover.
    return rows.sort((left, right) =>
      Number(right.archivedAt) - Number(left.archivedAt))
  }

  private collect(noteId: NoteSessionId, bucket: 'archived' | null): StoredMaterial[] {
    const rows: StoredMaterial[] = []
    for (const [id, record] of this.table.entries()) {
      if (record.noteId !== noteId) continue
      if (bucket === null ? record.archivedAt !== null : record.archivedAt === null) continue
      rows.push({ ...record, id })
    }
    return rows
  }

  /**
   * Store one material at the top of its conversation.
   * @param record - the complete material record; `order` is replaced.
   * @returns the minted material id.
   */
  async create(record: MaterialRecord): Promise<MaterialId> {
    const id = brandString<MaterialId>(randomUUID())
    await this.table.put(id, { ...record, order: this.topOrder(record.noteId) })
    return id
  }

  /**
   * Read one material by id.
   * @param id - material id.
   * @returns the stored material, or undefined when absent.
   */
  get(id: MaterialId): StoredMaterial | undefined {
    const record = this.table.get(id)
    return record === undefined ? undefined : { ...record, id }
  }

  /**
   * Replace one material.
   * @param id - material id.
   * @param fn - pure transform from the current record to the next.
   * @returns the stored next record.
   */
  async update(id: MaterialId, fn: (current: MaterialRecord) => MaterialRecord): Promise<MaterialRecord> {
    return await this.table.update(id, fn)
  }

  /**
   * Move one material to the archived bucket.
   * @param id - material id.
   */
  async archive(id: MaterialId): Promise<void> {
    await this.update(id, current => ({ ...current, archivedAt: Date.now() }))
  }

  /**
   * Return one archived material to the top of its conversation. An unknown id
   * is a no-op, so a restore racing a delete cannot fail the caller.
   * @param id - material id.
   */
  async restore(id: MaterialId): Promise<void> {
    const current = this.table.get(id)
    if (current === undefined) return
    await this.update(id, record => ({
      ...record,
      archivedAt: null,
      order: this.topOrder(record.noteId),
    }))
  }

  /**
   * Apply a complete manual ordering to one conversation.
   * @param noteId - notes conversation id.
   * @param orderedIds - every visible material of the conversation, top first.
   * @throws {Error} when an id is not a visible material of that conversation.
   */
  async reorder(noteId: NoteSessionId, orderedIds: readonly MaterialId[]): Promise<void> {
    const visible = new Set(this.list(noteId).map(row => row.id))
    for (const id of orderedIds) {
      if (!visible.has(id)) throw new Error(`notes: material '${id}' is not visible in this conversation`)
    }
    for (const [index, id] of orderedIds.entries()) {
      await this.update(id, record => ({ ...record, order: index }))
    }
  }

  /**
   * Delete one material record. Screenshot bytes it may reference are not
   * reclaimed: attachments are never collected automatically.
   * @param id - material id.
   */
  async remove(id: MaterialId): Promise<void> {
    await this.table.delete(id)
  }

  /** The order value that places a material above every visible sibling. */
  private topOrder(noteId: NoteSessionId): number {
    const visible = this.list(noteId)
    return visible.length === 0
      ? 0
      : Math.min(...visible.map(row => row.order)) - 1
  }
}

export default Materials
