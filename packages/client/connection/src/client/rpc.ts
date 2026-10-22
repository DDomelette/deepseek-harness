/** Browser caller for generic Connection unary RPC channels. */

import {
  RpcId,
  type ClientRequest,
  type RpcId as RpcIdType,
} from '../rpc.ts'
import type { ClientConnectionRpc, ConnectionRpcResult } from '../rpc.ts'
import { randomUuid } from './random-uuid.ts'

const INTERNAL_BASE = 'http://dsh.internal'
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

/** Transport this caller posts through; same signature as the global `fetch`. */
export type RpcFetch = (input: URL, init: RequestInit) => Promise<Response>

/**
 * A unary call the carrier refused with an HTTP status. The status is the one
 * fact a caller cannot recover from the message, and it is what separates an
 * expired browser session (401) from a rejected authority (403).
 */
export class ConnectionHttpError extends Error {
  /**
   * @param status - response status that failed the call.
   * @param message - diagnostic naming the target and the status.
   */
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'ConnectionHttpError'
  }
}

/** Worker-local opener for decoded Gateway Remote streams. */
export type RpcStreamOpen = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => AsyncIterable<unknown>

/**
 * Create the browser-backed generic RPC caller.
 * @param doFetch - transport override; defaults to the page's global fetch.
 * @param openStream - optional worker-local Gateway stream carrier.
 * @returns caller that owns request correlation and response-envelope validation.
 */
export function createWebConnectionRpc(doFetch?: RpcFetch, openStream?: RpcStreamOpen): ClientConnectionRpc {
  const send: RpcFetch = doFetch ?? ((input, init) => globalThis.fetch(input, init))
  return {
    async call(channel, endpoint, payload, signal) {
      assertTarget(channel, endpoint)
      const rpcId = RpcId(randomUuid())
      const message: ClientRequest = {
        type: 'client-request',
        rpcId,
        method: endpoint,
        payload,
      }
      const response = await send(
        requestUrl(channel, endpoint),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(message),
          ...signal === undefined ? {} : { signal },
        },
      )
      if (!response.ok) {
        throw new ConnectionHttpError(
          response.status,
          `transport failure for ${channel}/${endpoint}: HTTP ${String(response.status)}`,
        )
      }
      const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      const full = mediaType === 'multipart/form-data'
        ? await parseBinaryResponse(response)
        : parseConnectionResponse(await response.json())
      signal?.throwIfAborted()
      if (full.rpcId !== rpcId) {
        throw new Error(`rpcId mismatch for ${endpoint}: sent ${rpcId}, got ${full.rpcId}`)
      }
      return full.result
    },
    ...openStream === undefined ? {} : {
      open(channel, endpoint, payload, signal) {
        assertTarget(channel, endpoint)
        if (channel !== '/api') {
          throw new Error(`connection: worker-local streams require the /api channel, got ${JSON.stringify(channel)}`)
        }
        return openStream(endpoint, payload, signal)
      },
    },
  }
}

function parseConnectionResponse(value: unknown): {
  readonly rpcId: RpcIdType
  readonly result: ConnectionRpcResult<unknown>
} {
  if (!isRecord(value) || value.type !== 'server-response' || typeof value.rpcId !== 'string') {
    throw new TypeError('connection: invalid server-response envelope')
  }
  const result = value.result
  if (!isRecord(result)) throw new TypeError('connection: invalid server-response result')
  if (result.ok === true) {
    return {
      rpcId: RpcId(value.rpcId),
      result: { ok: true, value: result.value },
    }
  }
  if (result.ok !== false || !isRecord(result.error)) {
    throw new TypeError('connection: invalid server-response result')
  }
  const error = result.error
  if (typeof error.code !== 'string' || typeof error.message !== 'string' || !isRecord(error.details)) {
    throw new TypeError('connection: invalid server-response failure')
  }
  return {
    rpcId: RpcId(value.rpcId),
    result: {
      ok: false,
      error: { code: error.code, message: error.message, details: error.details },
    },
  }
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Decode a multipart unary envelope, writing each byte part back onto its path.
 * @param response - multipart response produced by the Host carrier.
 * @returns the same envelope shape the JSON carrier yields.
 */
async function parseBinaryResponse(response: Response): Promise<{
  readonly rpcId: RpcIdType
  readonly result: ConnectionRpcResult<unknown>
}> {
  const body = await response.formData()
  const fields = new Map<string, string | Blob>()
  for (const [name, value] of body) {
    if (fields.has(name)) throw new TypeError('connection: invalid binary response fields')
    fields.set(name, value)
  }
  const metadata = fields.get('metadata')
  fields.delete('metadata')
  if (typeof metadata !== 'string') {
    throw new TypeError('connection: invalid binary response fields')
  }
  const envelope: unknown = JSON.parse(metadata)
  const full = parseConnectionResponse(envelope)
  if (!full.result.ok || !isRecord(envelope) || !Array.isArray(envelope.attachments) || envelope.attachments.length === 0) {
    throw new TypeError('connection: invalid binary response result')
  }
  const root = { value: full.result.value }
  for (const attachment of envelope.attachments) {
    if (!isRecord(attachment) || attachment.codec !== 'bytes' || typeof attachment.part !== 'string'
      || !Array.isArray(attachment.path)) {
      throw new TypeError('connection: invalid binary response attachment')
    }
    const data = fields.get(attachment.part)
    fields.delete(attachment.part)
    if (!(data instanceof Blob)) {
      throw new TypeError('connection: invalid binary response fields')
    }
    let parent: object = root
    let key: string | number = 'value'
    for (const segment of attachment.path) {
      const value: unknown = Reflect.get(parent, key)
      if (typeof value !== 'object' || value === null) {
        throw new TypeError('connection: invalid binary response path')
      }
      if (Array.isArray(value)) {
        if (typeof segment !== 'number' || !Number.isSafeInteger(segment) || segment < 0 || segment >= value.length) {
          throw new TypeError('connection: invalid binary response path')
        }
      } else if (typeof segment !== 'string') {
        throw new TypeError('connection: invalid binary response path')
      }
      if (!Object.hasOwn(value, segment)) throw new TypeError('connection: invalid binary response path')
      parent = value
      key = segment
    }
    if (Reflect.get(parent, key) !== null) throw new TypeError('connection: invalid binary response placeholder')
    Object.defineProperty(parent, key, {
      value: new Uint8Array(await data.arrayBuffer()), enumerable: true, writable: true, configurable: true,
    })
  }
  if (fields.size !== 0) throw new TypeError('connection: invalid binary response fields')
  return { rpcId: full.rpcId, result: { ok: true, value: root.value } }
}

/**
 * Resolve one channel call against the base, keeping it inside the mount.
 * The channel name leads with `/`, which URL resolution would anchor at the
 * origin; trimming it makes the route relative to the base instead.
 * @param channel - validated channel name.
 * @param endpoint - validated endpoint path.
 * @returns the absolute request URL.
 */
function requestUrl(channel: string, endpoint: string): URL {
  const base = resolveBase()
  const root = base.endsWith('/') ? base : `${base}/`
  return new URL(`${channel.replace(/^\//u, '')}/${endpoint}`, root)
}

/**
 * Base every request resolves against, so a deployment that mounts the app
 * under a prefix keeps its RPC routes inside that mount. A document answers
 * with its own base; a worker has no document, so its script directory is the
 * equivalent anchor — its origin alone would leave the mount.
 * @returns the document base, the worker script directory, or the internal base.
 */
function resolveBase(): string {
  const documentBase = (globalThis as { document?: { baseURI?: string } }).document?.baseURI
  if (documentBase !== undefined && documentBase !== '' && documentBase !== 'null') return documentBase
  const href = (globalThis as { location?: { href?: string } }).location?.href
  if (href !== undefined && href !== '' && href !== 'null') return new URL('.', href).href
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin
  return origin !== undefined && origin !== 'null' ? origin : INTERNAL_BASE
}

function assertTarget(channel: string, endpoint: string): void {
  const segments = endpoint.split('/')
  if (!CHANNEL_PATTERN.test(channel)
    || segments.some(segment =>
      segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
    throw new Error(`connection: invalid RPC target ${JSON.stringify(`${channel}/${endpoint}`)}`)
  }
}
