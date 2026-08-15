/**
 * Browser-compatible canonical session-reference URI encoding.
 * The output is byte-identical to the host encoder in
 * `@deepseek-ai/dsh-session-reference` (`Buffer.toString('base64url')`).
 */

import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

const BYTE_CHUNK = 0x8000

/** Base64url-encode UTF-8 bytes without a Node Buffer dependency. */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BYTE_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BYTE_CHUNK))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Encode one session id as the canonical `dsh-session:` URI. */
export function encodeSessionReferenceUri(sessionId: SessionId): string {
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(sessionId)))
  return `dsh-session:${payload}`
}

/** Render one canonical Markdown mention with a readable label. */
export function formatSessionReferenceMention(sessionId: SessionId, label: string): string {
  const escaped = label.replace(/[\\\]]/gu, match => `\\${match}`)
  return `@[${escaped}](${encodeSessionReferenceUri(sessionId)})`
}
