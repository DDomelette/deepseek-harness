/**
 * Shared test bench: a real storage stack with the notes services mounted over
 * one temporary directory, plus the branded-id fixtures every spec needs.
 *
 * Each spec owns the directory it creates, so suites running in forked workers
 * beside the other gate processes never share a path.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import type { MaterialRecord, NoteSessionRecord } from '../src/domain.ts'
import { Materials } from '../src/materials.ts'
import { NoteSessions } from '../src/note-sessions.ts'
import { NotesStore } from '../src/store.ts'
import type { MaterialId, MaterialSource, NoteSessionId } from '../src/types.ts'

/** Brand a raw string as a material id. */
export const materialId = (value: string): MaterialId => brandString<MaterialId>(value)

/** Brand a raw string as a notes conversation id. */
export const noteId = (value: string): NoteSessionId => brandString<NoteSessionId>(value)

/** Brand a raw string as a session id. */
export const sessionId = (value: string): SessionId => brandString<SessionId>(value)

/** One collection source stamp; every fixture material shares it unless overridden. */
export const source = (overrides: Partial<MaterialSource> = {}): MaterialSource => ({
  sessionId: sessionId('source-session'),
  view: 'chat',
  seq: 1,
  messageId: null,
  callId: null,
  label: 'conversation «probe» turn 1',
  ...overrides,
})

/** A complete draft material record. */
export const material = (
  overrides: Partial<MaterialRecord> & { readonly noteId: NoteSessionId },
): MaterialRecord => ({
  kind: 'text',
  text: 'body',
  image: null,
  source: source(),
  action: null,
  order: 0,
  status: 'draft',
  messageIds: [],
  error: null,
  createdAt: 0,
  archivedAt: null,
  ...overrides,
})

/** A complete notes-conversation record. */
export const noteSession = (overrides: Partial<NoteSessionRecord> = {}): NoteSessionRecord => ({
  sessionId: sessionId('notes-session'),
  title: 'Notes · probe',
  createdAt: 0,
  archivedAt: null,
  ...overrides,
})

/** One mounted bench: the storage stack plus the notes services. */
export interface Bench {
  /** Host context carrying every mounted service. */
  readonly ctx: Context
  /** The temporary storage root this bench owns. */
  readonly root: string
  /** The notes domain owner. */
  readonly store: NotesStore
  /** Material storage. */
  readonly materials: Materials
  /** Notes-conversation records. */
  readonly sessions: NoteSessions
  /** Dispose the context and remove the temporary root. */
  dispose(): Promise<void>
}

/**
 * Mount a real storage stack and the notes services over a fresh temporary
 * directory.
 * @returns the mounted bench, with its own teardown.
 */
export async function bench(): Promise<Bench> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-notes-'))
  const ctx = new Context()
  await ctx.plugin(Storage).await()
  await ctx.plugin(StorageJson, { root }).await()
  await ctx.plugin(StorageDomain, { backend: 'json' }).await()
  await ctx.plugin(NotesStore).await()
  await ctx.plugin(Materials).await()
  await ctx.plugin(NoteSessions).await()
  return {
    ctx,
    root,
    store: ctx.notesStore,
    materials: ctx.notesMaterials,
    sessions: ctx.notesSessions,
    dispose: async () => {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}

/**
 * Wait until one service is published.
 *
 * A fiber settles as soon as its plugin body returns; a service whose
 * initialization awaits storage becomes resolvable only afterwards, so reading
 * a service immediately after its plugin's `await` can observe it absent.
 * @param read - probe returning a defined value once the service is published.
 * @param label - service name reported when the wait times out.
 */
export async function published(read: () => unknown, label: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (read() !== undefined) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error(`notes test bench never observed ${label}`)
}
