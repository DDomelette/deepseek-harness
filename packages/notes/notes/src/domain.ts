/**
 * The notes domain: durable materials and notes conversations.
 *
 * The session log stays the content truth; this domain stores only the
 * submitted message ids and the collection metadata. A material's text and a
 * model's answer live in the session events, never here. Record schemas are
 * zod (the durable boundary); the plugin's own `Config` stays schemastery.
 * @module @deepseek-ai/dsh-notes/domain
 */

import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentId, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type {
  MaterialId, MaterialKind, MaterialSource, MaterialStatus, MaterialView, NotesImageMediaType,
  NoteSessionId,
} from './types.ts'

/** Domain name; also the backend unit name. */
export const NOTES_DOMAIN_NAME = 'notes'

/**
 * Current domain format version. Version 2 stores the whole attachment
 * reference a screenshot was saved as; version 1 stored only its id.
 */
export const NOTES_DOMAIN_VERSION = 2

/** The domain's table names, as the owner opens them. */
export const NOTES_TABLES = {
  /** One record per collected material. */
  materials: 'materials',
  /** One record per notes conversation. */
  sessions: 'sessions',
} as const

// Branding has no runtime representation: the medium stores plain strings and
// numbers, and these schemas are what turn one back into its opaque id at the
// read boundary. Shape checks stay here with the brand, so a malformed stored
// value fails the open rather than entering memory unbranded.
const sessionIdSchema = z.string().transform(value => brandString<SessionId>(value))
const noteSessionIdSchema = z.string().transform(value => brandString<NoteSessionId>(value))
const messageIdSchema = z.string().transform(value => brandString<MessageId>(value))
const sessionSeqSchema = z.number().int().nonnegative()
  .transform(value => brandNumber<SessionSeq>(value))
const materialKindSchema: z.ZodType<MaterialKind> = z.union([z.literal('text'), z.literal('image')])
const materialViewSchema: z.ZodType<MaterialView> = z.union([z.literal('chat'), z.literal('trajectory')])
const materialStatusSchema: z.ZodType<MaterialStatus> = z.union([
  z.literal('draft'), z.literal('analyzing'), z.literal('analyzed'), z.literal('failed'),
])

const materialSourceSchema: z.ZodType<MaterialSource> = z.object({
  sessionId: sessionIdSchema,
  view: materialViewSchema,
  seq: sessionSeqSchema.nullable(),
  messageId: messageIdSchema.nullable(),
  callId: z.string().nullable(),
  label: z.string(),
})

const imageMediaTypeSchema: z.ZodType<NotesImageMediaType> = z.union([
  z.literal('image/png'), z.literal('image/jpeg'), z.literal('image/webp'), z.literal('image/gif'),
])

/**
 * One screenshot's durable attachment reference, as the attachment provider
 * wrote it.
 *
 * zod's `.optional()` types the two optional members `string | undefined` and
 * `{…} | undefined` where the attachment vocabulary says `name?: string` and
 * `originalDimensions?: …`; the two serialize identically (an absent member),
 * so the cast records exactly that `exactOptionalPropertyTypes` widening.
 */
const imageRefSchema = z.object({
  attachmentId: z.string().min(1).transform(value => brandString<AttachmentId>(value)),
  mediaType: imageMediaTypeSchema,
  bytes: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  name: z.string().optional(),
  originalDimensions: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).optional(),
}) as unknown as z.ZodType<ImageAttachmentRef>

/**
 * One collected material. `text` carries the user's edited body while the
 * material is a draft; once it enters a session the log carries the body and
 * this field is the text as submitted. `image` is the durable attachment
 * reference the screenshot was saved as — the bytes never enter this domain,
 * and the whole reference is kept because a model request part names it.
 */
export const materialRecord = z.object({
  noteId: noteSessionIdSchema,
  kind: materialKindSchema,
  text: z.string().nullable(),
  image: imageRefSchema.nullable(),
  source: materialSourceSchema,
  action: z.string().nullable(),
  order: z.number(),
  status: materialStatusSchema,
  messageIds: z.array(messageIdSchema),
  error: z.string().nullable(),
  createdAt: z.number(),
  archivedAt: z.number().nullable(),
})

/** One stored material record. */
export type MaterialRecord = z.infer<typeof materialRecord>

/** One notes conversation: the plugin's record of a real dsh Session. */
export const noteSessionRecord = z.object({
  sessionId: sessionIdSchema,
  title: z.string(),
  createdAt: z.number(),
  archivedAt: z.number().nullable(),
})

/** One stored notes-conversation record. */
export type NoteSessionRecord = z.infer<typeof noteSessionRecord>

/**
 * Domain-global state: the conversation the panel currently shows, so a
 * restart reopens the same one. `null` means no conversation exists yet.
 */
export const notesGlobal = z.object({
  activeNoteId: noteSessionIdSchema.nullable(),
})

/** Stored global state of the notes domain. */
export type NotesGlobalState = z.infer<typeof notesGlobal>

/**
 * The notes domain spec: materials and notes conversations, plus the active
 * pointer. `defineDomain` validates the names and the global's null handling
 * at module load, before any medium is touched.
 */
export const notesDomainSpec = defineDomain({
  name: NOTES_DOMAIN_NAME,
  version: NOTES_DOMAIN_VERSION,
  global: { schema: notesGlobal, initial: { activeNoteId: null } },
  tables: {
    materials: domainTable<MaterialId, MaterialRecord>(materialRecord),
    sessions: domainTable<NoteSessionId, NoteSessionRecord>(noteSessionRecord),
  },
})

/**
 * Open the notes domain and bind its lifetime to the caller's effect.
 *
 * The facility enforces one open per domain name, so exactly one owner calls
 * this: {@link NotesStore} opens it and hands the tables to every other
 * consumer.
 * @param ctx - host context carrying the storage domain facility.
 * @returns the opened domain handle.
 */
export async function openNotesDomain(ctx: Context): Promise<Domain<typeof notesDomainSpec>> {
  const domain = await ctx.storageDomain.open(notesDomainSpec)
  ctx.effect(() => () => domain.close(), 'notes: domain close')
  return domain
}
