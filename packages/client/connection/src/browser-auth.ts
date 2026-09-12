/** Browser-session authentication for the Host Connection carrier. */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { listDevices } from './devices.ts'
import { isLoopbackHostname } from './loopback-hostname.ts'
import { header, requestAuthority, requestHostname } from './request-authority.ts'
import type {
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionTrustRequest,
} from './rpc.ts'

const AUTH_RECORD_KEY = credentialKey('client-connection', 'browser-session')
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
const SECRET_BYTES = 32
const TOKEN_QUERY = 'token'
const COOKIE_PREFIX = 'dsh-auth-'
const COOKIE_PAYLOAD_VERSION = 1
const DEVICE_COOKIE_PAYLOAD_VERSION = 2
const STORED_SECRET_VERSION = 1
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/
const PROCESS_LAUNCH_TOKENS = new WeakMap<object, string>()

interface StoredSecretPayload {
  readonly version: typeof STORED_SECRET_VERSION
  readonly secret: string
}

interface BrowserCookiePayload {
  readonly version: typeof COOKIE_PAYLOAD_VERSION | typeof DEVICE_COOKIE_PAYLOAD_VERSION
  readonly authority: string
  readonly issuedAt: number
  readonly expiresAt: number
  /** Present on device cookies only; the registry decides whether it still counts. */
  readonly deviceId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function decodeBase64Url(value: string): Buffer | undefined {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) return undefined
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const decoded = Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/') + padding, 'base64')
  return encodeBase64Url(decoded) === value ? decoded : undefined
}

function processLaunchToken(owner: object): string {
  const existing = PROCESS_LAUNCH_TOKENS.get(owner)
  if (existing !== undefined) return existing
  const created = encodeBase64Url(randomBytes(SECRET_BYTES))
  PROCESS_LAUNCH_TOKENS.set(owner, created)
  return created
}

function canonicalSecret(value: unknown): Buffer | undefined {
  if (typeof value !== 'string') return undefined
  const decoded = decodeBase64Url(value)
  if (decoded === undefined || decoded.byteLength !== SECRET_BYTES) return undefined
  return decoded
}

function storedSecret(record: CredentialRecord | undefined): Buffer | undefined {
  if (record === undefined) return undefined
  if (record.kind !== 'grant' || !isRecord(record.payload)
    || record.payload.version !== STORED_SECRET_VERSION) {
    throw new Error('client-connection: browser-session credential record has an unsupported format')
  }
  const secret = canonicalSecret(record.payload.secret)
  if (secret === undefined) {
    throw new Error('client-connection: browser-session credential record has an invalid secret')
  }
  return secret
}

function tokenMatches(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  return actualBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(actualBytes, expectedBytes)
}

function cookieName(authority: string): string {
  return COOKIE_PREFIX + encodeBase64Url(createHash('sha256').update(authority).digest())
}

/** Read the exact generated cookie without implementing general Cookie decoding. */
function cookieValue(headerValue: string, name: string): string | undefined {
  for (const segment of headerValue.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1 || segment.slice(0, at).trim() !== name) continue
    return segment.slice(at + 1).trim()
  }
  return undefined
}

/** Serialize the fixed browser-session attributes; generated names and values are cookie-safe base64url. */
function sessionCookie(name: string, value: string, expiresAt: number, maxAgeSeconds: number): string {
  return `${name}=${value}; Max-Age=${String(maxAgeSeconds)}; Path=/; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; SameSite=Strict`
}

function signature(secret: Buffer, body: string): Buffer {
  return createHmac('sha256', secret).update(body).digest()
}

function encodeCookie(payload: BrowserCookiePayload, secret: Buffer): string {
  const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const envelope = payload.version === DEVICE_COOKIE_PAYLOAD_VERSION ? 'v2' : 'v1'
  return `${envelope}.${body}.${encodeBase64Url(signature(secret, body))}`
}

function decodeCookie(value: string, secret: Buffer): BrowserCookiePayload | undefined {
  const parts = value.split('.')
  const [envelope, body, encodedSignature] = parts
  const version = envelope === 'v1' ? COOKIE_PAYLOAD_VERSION : envelope === 'v2' ? DEVICE_COOKIE_PAYLOAD_VERSION : undefined
  if (parts.length !== 3 || version === undefined || body === undefined || encodedSignature === undefined) {
    return undefined
  }
  const actualSignature = decodeBase64Url(encodedSignature)
  if (actualSignature === undefined) return undefined
  const expectedSignature = signature(secret, body)
  if (actualSignature.byteLength !== expectedSignature.byteLength
    || !timingSafeEqual(actualSignature, expectedSignature)) return undefined
  let decoded: unknown
  try {
    const bodyBytes = decodeBase64Url(body)
    if (bodyBytes === undefined) return undefined
    decoded = JSON.parse(bodyBytes.toString('utf8'))
  } catch {
    return undefined
  }
  if (!isRecord(decoded)
    || decoded.version !== version
    || typeof decoded.authority !== 'string'
    || !Number.isSafeInteger(decoded.issuedAt)
    || !Number.isSafeInteger(decoded.expiresAt)) return undefined
  if (version === DEVICE_COOKIE_PAYLOAD_VERSION
    && (typeof decoded.deviceId !== 'string' || decoded.deviceId === '')) return undefined
  return decoded as unknown as BrowserCookiePayload
}

async function initializeSecret(credentials: CredentialProvider): Promise<Buffer> {
  const generated: StoredSecretPayload = {
    version: STORED_SECRET_VERSION,
    secret: encodeBase64Url(randomBytes(SECRET_BYTES)),
  }
  const record = await credentials.modifyRecord(AUTH_RECORD_KEY, (current) => {
    if (current !== undefined) {
      storedSecret(current)
      return Promise.resolve(undefined)
    }
    return Promise.resolve({ kind: 'grant', payload: generated })
  })
  const secret = storedSecret(record)
  if (secret === undefined) {
    throw new Error('client-connection: browser-session credential record was not created')
  }
  return secret
}

/**
 * Process launch-token exchange, persistent signed-cookie verification, and the
 * paired-device cookies the LAN pairing handshake issues. Connection loads the
 * credential provider's signing secret and the paired-device registry during
 * activation and retains both for synchronous request authentication.
 */
export class BrowserAuth {
  private readonly launchToken: string
  private readonly maxAgeMilliseconds: number
  private readonly deviceMaxAgeMilliseconds: number
  private pairedDeviceIds: ReadonlySet<string>

  private constructor(
    processOwner: object,
    private readonly credentials: CredentialProvider,
    private readonly secret: Buffer,
    maxAgeDays: number,
    deviceMaxAgeDays: number,
    pairedDeviceIds: ReadonlySet<string>,
  ) {
    this.launchToken = processLaunchToken(processOwner)
    this.maxAgeMilliseconds = maxAgeDays * DAY_MILLISECONDS
    this.deviceMaxAgeMilliseconds = deviceMaxAgeDays * DAY_MILLISECONDS
    this.pairedDeviceIds = pairedDeviceIds
    for (const milliseconds of [this.maxAgeMilliseconds, this.deviceMaxAgeMilliseconds]) {
      if (!Number.isSafeInteger(milliseconds) || !Number.isSafeInteger(Date.now() + milliseconds)) {
        throw new Error('client-connection: cookieMaxAgeDays exceeds the safe timestamp range')
      }
    }
  }

  /**
   * Initialize browser authentication, create its durable signing secret when
   * this Harness home has none, and load the paired-device registry.
   * @param processOwner - root application context retaining one token across Connection reloads.
   * @param credentials - persistent credential provider for the Web profile.
   * @param maxAgeDays - positive absolute launch-token cookie lifetime in days.
   * @param deviceMaxAgeDays - positive absolute paired-device cookie lifetime in days.
   * @returns initialized authentication owner with the process owner's launch token.
   */
  static async create(
    processOwner: object,
    credentials: CredentialProvider,
    maxAgeDays: number,
    deviceMaxAgeDays: number,
  ): Promise<BrowserAuth> {
    const secret = await initializeSecret(credentials)
    const devices = await listDevices(credentials)
    return new BrowserAuth(
      processOwner,
      credentials,
      secret,
      maxAgeDays,
      deviceMaxAgeDays,
      new Set(devices.map(device => device.id)),
    )
  }

  /**
   * Add this process's launch token to the ordinary application root URL.
   * @param baseUrl - canonical browser origin without credentials.
   * @returns root URL carrying the process token as its sole authentication input.
   */
  authenticatedUrl(baseUrl: string): string {
    const url = new URL(baseUrl)
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    url.searchParams.set(TOKEN_QUERY, this.launchToken)
    return url.href
  }

  /**
   * Mint the cookie a phone receives once its pairing request is approved.
   * @param authority - canonical `host:port` the cookie is bound to.
   * @param deviceId - registry id of the approved device.
   * @returns the complete `Set-Cookie` value, valid while that device stays registered.
   */
  issueDeviceCookie(authority: string, deviceId: string): string {
    const issuedAt = Date.now()
    const expiresAt = issuedAt + this.deviceMaxAgeMilliseconds
    const value = encodeCookie({
      version: DEVICE_COOKIE_PAYLOAD_VERSION,
      authority,
      deviceId,
      issuedAt,
      expiresAt,
    }, this.secret)
    return sessionCookie(
      cookieName(authority), value, expiresAt, Math.floor(this.deviceMaxAgeMilliseconds / 1000),
    )
  }

  /**
   * Re-read the paired-device registry, so a registration or revocation reaches
   * the request path without restarting the Host.
   * @returns nothing; the refreshed registry is installed before it resolves.
   */
  async refreshPairedDevices(): Promise<void> {
    const devices = await listDevices(this.credentials)
    this.pairedDeviceIds = new Set(devices.map(device => device.id))
  }

  /**
   * Authenticate an index request. A valid root query token mints the cookie
   * and redirects to clean `/`; a valid cookie lets the caller serve the
   * index; every other request receives the same minimal 401 response.
   * @param req - incoming root or configured-index request.
   * @param res - response owned when this method returns false.
   * @returns true only when the caller may serve index.html.
   */
  authorizeIndex(req: ConnectionIndexRequest, res: ConnectionIndexResponse): boolean {
    /* v8 ignore next -- node:http always supplies url on server requests. */
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    const tokens = url.searchParams.getAll(TOKEN_QUERY)
    if (tokens.length > 0) {
      const authority = requestAuthority(req.headers)
      const hostname = requestHostname(req.headers)
      // The process launch token is the computer's own credential: it is
      // exchanged only where the operator's own machine reached this Host, so a
      // token-bearing LAN URL a phone opens grants that phone nothing.
      if (req.method === 'GET' && url.pathname === '/' && tokens.length === 1
        && authority !== undefined && hostname !== undefined && isLoopbackHostname(hostname)
        && tokenMatches(tokens.join(''), this.launchToken)) {
        const issuedAt = Date.now()
        const expiresAt = issuedAt + this.maxAgeMilliseconds
        const value = encodeCookie({
          version: COOKIE_PAYLOAD_VERSION,
          authority,
          issuedAt,
          expiresAt,
        }, this.secret)
        res.writeHead(303, {
          'cache-control': 'no-store',
          'location': '/',
          'referrer-policy': 'no-referrer',
          'set-cookie': sessionCookie(
            cookieName(authority), value, expiresAt, Math.floor(this.maxAgeMilliseconds / 1000),
          ),
        })
        res.end()
        return false
      }
      if (req.method === 'GET' && url.pathname === '/' && this.isAuthenticated(req)) {
        res.writeHead(303, {
          'cache-control': 'no-store',
          'location': '/',
          'referrer-policy': 'no-referrer',
        })
        res.end()
        return false
      }
      this.writeUnauthorized(req, res)
      return false
    }
    if (this.isAuthenticated(req)) return true
    this.writeUnauthorized(req, res)
    return false
  }

  /**
   * Verify the authority-bound browser cookie on a Host request. A device cookie
   * must name a device the registry still holds, on the authority it was issued
   * for; a launch-token cookie is the computer's own and counts only on a
   * loopback authority, so revoking a device is the whole story for every phone.
   * @param request - request headers carrying Host and Cookie.
   * @returns true only for a cookie this activation still accepts.
   */
  isAuthenticated(request: ConnectionTrustRequest): boolean {
    const authority = requestAuthority(request.headers)
    const rawCookie = header(request.headers, 'cookie')
    if (authority === undefined || rawCookie === undefined) return false
    const value = cookieValue(rawCookie, cookieName(authority))
    if (value === undefined) return false
    const payload = decodeCookie(value, this.secret)
    if (payload === undefined || payload.authority !== authority) return false
    const now = Date.now()
    if (!(payload.issuedAt <= now
      && payload.expiresAt > now
      && payload.expiresAt > payload.issuedAt)) return false
    if (payload.version === DEVICE_COOKIE_PAYLOAD_VERSION) {
      return payload.deviceId !== undefined
        && this.pairedDeviceIds.has(payload.deviceId)
        && payload.expiresAt - payload.issuedAt <= this.deviceMaxAgeMilliseconds
    }
    const hostname = requestHostname(request.headers)
    return hostname !== undefined && isLoopbackHostname(hostname)
      && payload.expiresAt - payload.issuedAt <= this.maxAgeMilliseconds
  }

  private writeUnauthorized(req: ConnectionIndexRequest, res: ConnectionIndexResponse): void {
    res.writeHead(401, {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
    })
    res.end(req.method === 'HEAD'
      ? undefined
      : 'dsh web authentication required; reopen the URL printed by dsh web.\n')
  }
}
