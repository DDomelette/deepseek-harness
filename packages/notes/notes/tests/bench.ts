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
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { LlmModelInfo, MessageId, ModelModality } from '@deepseek-ai/dsh-llm'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type { MaterialRecord, NoteSessionRecord } from '../src/domain.ts'
import { Materials } from '../src/materials.ts'
import { NoteSessions } from '../src/note-sessions.ts'
import { NotesSettings } from '../src/settings.ts'
import type { Config } from '../src/settings.ts'
import { NotesStore } from '../src/store.ts'
import type { MaterialId, MaterialSource, NoteSessionId } from '../src/types.ts'

/** Brand a raw string as a material id. */
export const materialId = (value: string): MaterialId => brandString<MaterialId>(value)

/** Brand a raw string as a durable message id. */
export const messageId = (value: string): MessageId => brandString<MessageId>(value)

/** Brand a raw string as a notes conversation id. */
export const noteId = (value: string): NoteSessionId => brandString<NoteSessionId>(value)

/** Brand a raw string as a session id. */
export const sessionId = (value: string): SessionId => brandString<SessionId>(value)

/** Brand a raw number as a session sequence. */
export const sessionSeq = (value: number): SessionSeq => brandNumber<SessionSeq>(value)

/** One collection source stamp; every fixture material shares it unless overridden. */
export const source = (overrides: Partial<MaterialSource> = {}): MaterialSource => ({
  sessionId: sessionId('source-session'),
  view: 'chat',
  seq: sessionSeq(1),
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

/**
 * One stored screenshot reference, the shape an attachment provider returns.
 * @param attachmentId - the durable id, defaulting to the first stored image.
 * @returns the reference a material records for its screenshot.
 */
export const imageRef = (attachmentId = 'attachment-1'): ImageAttachmentRef => ({
  attachmentId: brandString<ImageAttachmentRef['attachmentId']>(attachmentId),
  mediaType: 'image/png',
  bytes: 3,
  width: 1,
  height: 1,
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
  /** The agent-registry stand-in the mounted services resolve. */
  readonly agents: FakeAgents
  /** The notes domain owner. */
  readonly store: NotesStore
  /** Material storage. */
  readonly materials: Materials
  /** Notes-conversation records. */
  readonly sessions: NoteSessions
  /** The live settings section. */
  readonly settings: NotesSettings
  /** Dispose the context and remove the temporary root. */
  dispose(): Promise<void>
}

/** One recorded follow-up submission. */
type FollowupCall = (message: unknown) => void

/**
 * Stand-in for the agent registry. The bench mounts it because every notes
 * service that starts or drives a conversation injects `agents`; a spec that
 * only stores records still needs the service present for the store to
 * activate.
 */
export class FakeAgents {
  /** Every accepted `create` request, in call order. */
  readonly created: Record<string, unknown>[] = []

  /** The handle returned by each accepted `create`, in call order. */
  readonly handles: { disposed: boolean }[] = []

  /** Set to make the next `create` reject, which the caller must roll back. */
  failure: Error | undefined

  /** The route every live agent reports, as `Agent.options` reports it. */
  route: AgentOptions = { provider: 'notes-provider', model: 'notes-model' }

  /**
   * Records every message handed to a live agent. The annotation is required:
   * an inferred `vi.fn()` type names a vitest-internal type and is not
   * portable across the package boundary.
   */
  readonly followup: Mock<FollowupCall> = vi.fn<FollowupCall>()

  /** Sessions this stand-in holds live, resolved by {@link get}. */
  private readonly live = new Set<string>()

  /** The event log every live session's snapshot reports. */
  private events: readonly unknown[] = []

  /**
   * Mark one dsh session id live.
   * @param id - the session the stand-in should resolve.
   */
  open(id: string): void {
    this.live.add(id)
  }

  /**
   * Replace the event log every live session reports.
   * @param events - the session events a reader should see, in log order.
   */
  record(events: readonly unknown[]): void {
    this.events = events
  }

  /**
   * Accept one creation request.
   * @param options - the caller's creation options, recorded verbatim.
   * @returns an inert handle whose disposal is observable.
   * @throws the configured {@link failure}, when one is set.
   */
  async create(options: Record<string, unknown>): Promise<{
    agent: unknown
    dispose: () => Promise<void>
  }> {
    if (this.failure !== undefined) throw this.failure
    this.created.push(options)
    const handle = { disposed: false }
    this.handles.push(handle)
    return {
      agent: {},
      dispose: async () => {
        handle.disposed = true
      },
    }
  }

  /**
   * Resolve the live agent of one session.
   * @param id - session id.
   * @returns the agent stand-in, or undefined when the session is not live.
   */
  get(id: string): {
    followup: FakeAgents['followup']
    options: AgentOptions
    session: { snapshotEvents: () => readonly unknown[] }
  } | undefined {
    return this.live.has(id)
      ? { followup: this.followup, options: this.route, session: { snapshotEvents: () => this.events } }
      : undefined
  }
}

/**
 * Stand-in for the LLM service's model metadata. A spec scripts the modalities
 * one route declares; `undefined` reports what the vocabulary calls unknown.
 */
export class FakeLlm {
  /** Input modalities every route declares, or undefined for unknown capability. */
  modalities: readonly ModelModality[] | undefined = ['text', 'image']

  /** Set to make the next resolution reject, which callers read as unknown. */
  failure: Error | undefined

  /** Every route this stand-in was asked about, in call order. */
  readonly asked: { provider: string; model: string }[] = []

  /**
   * Report one route's metadata.
   * @param provider - registered provider route.
   * @param model - provider-owned model id.
   * @returns the model metadata, with the scripted modalities when set.
   * @throws the configured {@link failure}, when one is set.
   */
  readonly resolveModelInfo = async (provider: string, model: string): Promise<LlmModelInfo> => {
    this.asked.push({ provider, model })
    if (this.failure !== undefined) throw this.failure
    return {
      provider,
      id: model,
      name: model,
      ...this.modalities === undefined ? {} : { inputModalities: [...this.modalities] },
    }
  }
}

/**
 * Mount a real storage stack, an agent-registry stand-in, the settings
 * section, and the notes services over a fresh temporary directory.
 * @param settings - the composition entry the settings section serves.
 * @returns the mounted bench, with its own teardown.
 */
export async function bench(settings: Config = { strategy: 'manual', actions: [] }): Promise<Bench> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-notes-'))
  const ctx = new Context()
  const agents = new FakeAgents()
  await ctx.plugin(Storage).await()
  await ctx.plugin(StorageJson, { root }).await()
  await ctx.plugin(StorageDomain, { backend: 'json' }).await()
  await ctx.plugin(NotesStore).await()
  ctx.provide('agents', agents as never)
  await ctx.plugin(NotesSettings, settings).await()
  await ctx.plugin(Materials).await()
  await ctx.plugin(NoteSessions).await()
  return {
    ctx,
    root,
    agents,
    store: ctx.notesStore,
    materials: ctx.notesMaterials,
    sessions: ctx.notesSessions,
    settings: ctx.notesSettings,
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
