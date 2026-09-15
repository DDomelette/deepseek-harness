/**
 * Reading a screenshot a reader hands the notes.
 *
 * Two entry points hand over an image file — the panel's own picker and a paste
 * inside the panel — so the media types a collection accepts and the browser
 * read that produces the collection payload live here instead of beside either
 * one. The bytes travel as canonical base64 because that is the form the
 * attachment store takes over the wire.
 * @module @deepseek-ai/dsh-notes/client/image
 */

import type { NotesImageMediaType } from '../types.ts'

/** The image media types a collection accepts, in picker order. */
export const IMAGE_TYPES: readonly NotesImageMediaType[] = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
]

/** One image as the Host's collection payload takes it. */
export interface CollectedImage {
  /** The media type the bytes carry. */
  readonly mediaType: NotesImageMediaType
  /** Canonical base64 of the bytes, without a data-URL prefix. */
  readonly data: string
}

/** Why an image cannot be collected, before any Host call is made. */
export type ImageRefusal = { readonly code: 'image-format' } | { readonly code: 'image-unreadable' }

/**
 * Read one image file for a collection.
 * @param file - the file a picker or a paste produced.
 * @returns the collection payload, or the local refusal that stopped it.
 */
export async function readImage(file: File): Promise<CollectedImage | ImageRefusal> {
  const mediaType = IMAGE_TYPES.find(candidate => candidate === file.type)
  if (mediaType === undefined) return { code: 'image-format' }
  const data = await readBase64(file)
  return data === null ? { code: 'image-unreadable' } : { mediaType, data }
}

/**
 * Read one file as the canonical base64 a collection payload carries.
 * @param file - the file to read.
 * @returns the payload, or null when the browser could not read the file.
 */
export function readBase64(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => { resolve(payloadOf(reader.result)) }
    reader.onerror = () => { resolve(null) }
    reader.readAsDataURL(file)
  })
}

/**
 * Take the payload out of a data-URL read result.
 * @param result - the reader's result.
 * @returns the base64 payload, or null for anything that is not a data URL.
 */
export function payloadOf(result: string | ArrayBuffer | null): string | null {
  if (typeof result !== 'string') return null
  const comma = result.indexOf(',')
  return comma < 0 ? null : result.slice(comma + 1)
}
