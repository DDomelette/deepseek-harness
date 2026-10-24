/**
 * LSP base-protocol framing: `Content-Length`-delimited JSON-RPC over a byte stream. The encoder
 * produces one framed buffer; the decoder buffers incoming bytes and yields complete message bodies,
 * bounding the header and total message size so a hostile or broken server cannot exhaust memory.
 * @module @deepseek-ai/dsh-lsp-stdio/framing
 */

/** The header/body separator in the LSP base protocol. */
const HEADER_SEPARATOR = '\r\n\r\n'

/** Cap on the header section so a server that never sends the separator cannot grow the buffer forever. */
const MAX_HEADER_BYTES = 1 << 16

/**
 * Encode one JSON-RPC message as a framed LSP buffer (`Content-Length: N\r\n\r\n<utf-8 json>`).
 * @param message - the JSON-RPC message object to serialize.
 * @returns the framed bytes ready to write to the server's stdin.
 */
export function encodeMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii')
  return Buffer.concat([header, body])
}

/**
 * A streaming decoder for `Content-Length`-framed JSON-RPC. Feed it stdout chunks; it returns any
 * whole message bodies that completed. It parses only the `Content-Length` header and ignores other
 * headers (e.g. `Content-Type`), matching the base protocol. Pending bytes are held as the segments
 * they arrived in and joined only to read one frame, so a large body costs one copy per message
 * rather than a re-copy of everything received so far.
 */
export class MessageDecoder {
  /** Pending bytes in arrival order; an empty segment is never retained. */
  private chunks: Buffer[] = []
  private length = 0
  private readonly maxMessageBytes: number

  /**
   * @param maxMessageBytes - reject any single framed body larger than this (guards memory).
   */
  constructor(maxMessageBytes: number) {
    this.maxMessageBytes = maxMessageBytes
  }

  /**
   * Append a chunk and return every message body that is now complete.
   * @param chunk - raw bytes from the server's stdout.
   * @returns the parsed JSON bodies, in arrival order (possibly empty).
   * @throws Error when a header is malformed or a body exceeds `maxMessageBytes`.
   */
  push(chunk: Buffer): unknown[] {
    if (chunk.length > 0) {
      this.chunks.push(chunk)
      this.length += chunk.length
    }
    const messages: unknown[] = []
    for (;;) {
      const step = this.next()
      if (!step.ready) break
      messages.push(step.message)
    }
    return messages
  }

  /** Parse and consume the next complete message, or report that more bytes are needed. */
  private next(): { ready: false } | { ready: true; message: unknown } {
    const separator = this.separatorOffset()
    if (separator < 0) {
      if (this.length > MAX_HEADER_BYTES) {
        throw new Error(`LSP header exceeded ${MAX_HEADER_BYTES} bytes without a terminator`)
      }
      return { ready: false }
    }
    if (separator > MAX_HEADER_BYTES) {
      throw new Error(`LSP header exceeded ${MAX_HEADER_BYTES} bytes`)
    }
    const contentLength = parseContentLength(this.slice(0, separator).toString('ascii'))
    if (contentLength > this.maxMessageBytes) {
      throw new Error(`LSP message length ${contentLength} exceeds the ${this.maxMessageBytes}-byte limit`)
    }
    const bodyStart = separator + HEADER_SEPARATOR.length
    const bodyEnd = bodyStart + contentLength
    if (this.length < bodyEnd) return { ready: false }
    const body = this.slice(bodyStart, bodyEnd).toString('utf8')
    this.consume(bodyEnd)
    try {
      return { ready: true, message: JSON.parse(body) }
    } catch (error) {
      /* v8 ignore next -- JSON.parse throws a SyntaxError (an Error); the String() fallback is defensive. */
      throw new Error(`LSP message body was not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Offset of the first header/body separator, found without joining the pending segments.
   * @returns the offset, or -1 when no complete separator has arrived.
   */
  private separatorOffset(): number {
    // The separator can straddle a segment boundary, so each segment is searched
    // with the last bytes of the one before it.
    const carryLength = HEADER_SEPARATOR.length - 1
    let base = 0
    let carry: Buffer = Buffer.alloc(0)
    for (const chunk of this.chunks) {
      const haystack: Buffer = carry.length === 0 ? chunk : Buffer.concat([carry, chunk])
      const found = haystack.indexOf(HEADER_SEPARATOR)
      if (found >= 0) return base - carry.length + found
      carry = haystack.subarray(Math.max(0, haystack.length - carryLength))
      base += chunk.length
    }
    return -1
  }

  /**
   * Copy one byte range out of the pending segments.
   * @param start - first byte to take.
   * @param end - exclusive end offset.
   * @returns the bytes of that range, joined only when they span segments.
   */
  private slice(start: number, end: number): Buffer {
    const parts: Buffer[] = []
    let offset = 0
    for (const chunk of this.chunks) {
      const chunkEnd = offset + chunk.length
      if (chunkEnd > start && offset < end) {
        parts.push(chunk.subarray(Math.max(0, start - offset), Math.min(chunk.length, end - offset)))
      }
      offset = chunkEnd
      if (offset >= end) break
    }
    const [only] = parts
    return parts.length === 1 && only !== undefined ? only : Buffer.concat(parts)
  }

  /**
   * Drop the leading bytes of one consumed frame.
   * @param count - number of leading bytes to remove.
   */
  private consume(count: number): void {
    let remaining = count
    while (remaining > 0) {
      const head = this.chunks[0]
      /* v8 ignore next -- the loop is bounded by the pending length this call consumed. */
      if (head === undefined) break
      if (head.length <= remaining) {
        this.chunks.shift()
        remaining -= head.length
        continue
      }
      this.chunks[0] = head.subarray(remaining)
      remaining = 0
    }
    this.length -= count
  }
}

/** Read the `Content-Length` header value (case-insensitive), rejecting a missing or non-numeric one. */
function parseContentLength(headerText: string): number {
  for (const line of headerText.split('\r\n')) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    if (line.slice(0, colon).trim().toLowerCase() !== 'content-length') continue
    const value = Number(line.slice(colon + 1).trim())
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`invalid Content-Length header: ${JSON.stringify(line)}`)
    }
    return value
  }
  throw new Error(`LSP header block missing Content-Length: ${JSON.stringify(headerText)}`)
}
