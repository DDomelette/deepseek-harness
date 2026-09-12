/** Browser launch-token and persistent-cookie behavior. */

import { createHash, createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { BrowserAuth } from '../src/browser-auth.ts'
import type { ConnectionIndexRequest, ConnectionIndexResponse } from '../src/rpc.ts'
import { RecordCredentials } from './browser-credentials.ts'

/** Cookie name a browser holding a cookie for this authority would send. */
function cookieNameFor(authority: string): string {
  return `dsh-auth-${createHash('sha256').update(authority).digest('base64url')}`
}

function signedCookie(store: RecordCredentials, name: string, payload: unknown, envelope = 'v1'): string {
  const body = typeof payload === 'string'
    ? Buffer.from(payload, 'utf8').toString('base64url')
    : Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return signedBodyCookie(store, name, body, envelope)
}

function signedBodyCookie(store: RecordCredentials, name: string, body: string, envelope = 'v1'): string {
  const record = store.record
  if (record?.kind !== 'grant' || typeof record.payload !== 'object' || record.payload === null) {
    throw new Error('test credential store has no signing secret')
  }
  const secret: unknown = Reflect.get(record.payload, 'secret')
  if (typeof secret !== 'string') throw new Error('test credential record has no string secret')
  const signature = createHmac('sha256', Buffer.from(secret, 'base64url')).update(body).digest('base64url')
  return `${name}=${envelope}.${body}.${signature}`
}

interface ResponseState {
  status?: number
  headers?: Readonly<Record<string, string>>
  body?: string
}

function response(): { value: ConnectionIndexResponse; state: ResponseState } {
  const state: ResponseState = {}
  return {
    value: {
      writeHead(status, headers) {
        state.status = status
        if (headers !== undefined) state.headers = headers
      },
      end(body) {
        if (body !== undefined) state.body = body
      },
    },
    state,
  }
}

function credentials(store: RecordCredentials): CredentialProvider {
  return store as unknown as CredentialProvider
}

function createAuth(
  store: RecordCredentials,
  maxAgeDays = 30,
  processOwner: object = {},
  deviceMaxAgeDays = 180,
): Promise<BrowserAuth> {
  return BrowserAuth.create(processOwner, credentials(store), maxAgeDays, deviceMaxAgeDays)
}

/** One stored paired-device entry, as the browser-auth tests seed it. */
function deviceEntry(id: string, label = id): Record<string, unknown> {
  return { id, label, registeredAt: 1_700_000_000_000, lastSeenAt: 1_700_000_000_000 }
}

/** The `name=value` half of a `Set-Cookie` value, as a request `Cookie` header carries it. */
function cookiePair(setCookie: string): string {
  return setCookie.split(';', 1)[0]!
}

function request(url: string, authority = '127.0.0.1:3080', init?: {
  cookie?: string
  method?: string
}): ConnectionIndexRequest {
  return {
    method: init?.method ?? 'GET',
    url,
    headers: {
      host: authority,
      ...init?.cookie === undefined ? {} : { cookie: init.cookie },
    },
  }
}

function exchange(
  auth: BrowserAuth,
  authority = '127.0.0.1:3080',
): { cookie: string; launchUrl: string; state: ResponseState } {
  const launchUrl = auth.authenticatedUrl(`http://${authority}`)
  const target = new URL(launchUrl)
  const res = response()
  expect(auth.authorizeIndex(request(`${target.pathname}${target.search}`, authority), res.value)).toBe(false)
  const setCookie = res.state.headers?.['set-cookie']
  if (setCookie === undefined) throw new Error('token exchange did not set a cookie')
  return { cookie: setCookie.split(';', 1)[0]!, launchUrl, state: res.state }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('BrowserAuth', () => {
  it('mints one process token and a persistent authority-bound cookie', async () => {
    const store = new RecordCredentials()
    const processOwner = {}
    const first = await createAuth(store, 30, processOwner)
    const login = exchange(first)

    expect(login.state).toMatchObject({
      status: 303,
      headers: {
        'cache-control': 'no-store',
        'location': '/',
        'referrer-policy': 'no-referrer',
      },
    })
    expect(login.state.headers?.['set-cookie']).toMatch(/; Max-Age=2592000; Path=\/; Expires=.*; HttpOnly; SameSite=Strict$/u)
    expect(login.state.headers?.['set-cookie']).not.toContain('Secure')
    expect(first.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: login.cookie }))).toBe(true)
    expect(first.isAuthenticated({
      headers: new Headers({ host: '127.0.0.1:3080', cookie: login.cookie }),
    })).toBe(true)
    expect(first.isAuthenticated({ headers: new Headers() })).toBe(false)
    expect(first.isAuthenticated(request('/', 'localhost:3080', { cookie: login.cookie }))).toBe(false)
    expect(first.isAuthenticated(request('/', '127.0.0.1:3081', { cookie: login.cookie }))).toBe(false)

    const reloaded = await createAuth(store, 30, processOwner)
    expect(reloaded.authenticatedUrl('http://127.0.0.1:3080')).toBe(login.launchUrl)
    expect(reloaded.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: login.cookie }))).toBe(true)

    const restarted = await createAuth(store)
    expect(new URL(restarted.authenticatedUrl('http://127.0.0.1:3080')).searchParams.get('token'))
      .not.toBe(new URL(login.launchUrl).searchParams.get('token'))
    expect(restarted.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: login.cookie }))).toBe(true)
    const staleUrl = new URL(login.launchUrl)
    const redirected = response()
    expect(restarted.authorizeIndex(request(
      `${staleUrl.pathname}${staleUrl.search}`,
      '127.0.0.1:3080',
      { cookie: login.cookie },
    ), redirected.value)).toBe(false)
    expect(redirected.state).toEqual({
      status: 303,
      headers: {
        'cache-control': 'no-store',
        'location': '/',
        'referrer-policy': 'no-referrer',
      },
    })
  })

  it('accepts the cookie for index serving and gives every unauthenticated request one response', async () => {
    const auth = await createAuth(new RecordCredentials())
    const { cookie } = exchange(auth)
    const allowed = response()
    expect(auth.authorizeIndex(request('/index.html', '127.0.0.1:3080', { cookie }), allowed.value)).toBe(true)
    expect(allowed.state).toEqual({})

    for (const candidate of [
      request('/'),
      request('/?token=wrong'),
      request('/?token=wrong&token=again'),
      request('/index.html?token=wrong'),
      request(auth.authenticatedUrl('http://127.0.0.1:3080'), '127.0.0.1:3080', { method: 'HEAD' }),
    ]) {
      const denied = response()
      expect(auth.authorizeIndex(candidate, denied.value)).toBe(false)
      expect(denied.state.status).toBe(401)
      expect(denied.state.headers).toEqual({
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
      })
      expect(denied.state.body).toBe(candidate.method === 'HEAD'
        ? undefined
        : 'dsh web authentication required; reopen the URL printed by dsh web.\n')
    }
  })

  it('rejects tampering, expiry, future issuance, and a longer lifetime than configured', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T00:00:00.000Z'))
    const store = new RecordCredentials()
    const auth = await createAuth(store)
    const { cookie } = exchange(auth)
    const [name, value] = cookie.split('=') as [string, string]

    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: `${name}=broken` }))).toBe(false)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: `${name}=${value.slice(0, -1)}x` }))).toBe(false)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: `${name}=%` }))).toBe(false)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', {
      cookie: signedBodyCookie(store, name, 'a'),
    }))).toBe(false)
    expect(auth.isAuthenticated({ headers: {} })).toBe(false)
    expect(auth.isAuthenticated({ headers: { host: 'bad host', cookie } })).toBe(false)
    expect(auth.isAuthenticated({ headers: { host: '127.0.0.1:3080' } })).toBe(false)

    const invalidPayloads: unknown[] = [
      'not json',
      null,
      { version: 2, authority: '127.0.0.1:3080', issuedAt: Date.now(), expiresAt: Date.now() + 1000 },
      { version: 1, authority: 42, issuedAt: Date.now(), expiresAt: Date.now() + 1000 },
      { version: 1, authority: '127.0.0.1:3080', issuedAt: 'now', expiresAt: Date.now() + 1000 },
      { version: 1, authority: '127.0.0.1:3080', issuedAt: Date.now(), expiresAt: 'later' },
    ]
    for (const payload of invalidPayloads) {
      expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', {
        cookie: signedCookie(store, name, payload),
      }))).toBe(false)
    }

    const deviceLifetime = { authority: '127.0.0.1:3080', issuedAt: Date.now(), expiresAt: Date.now() + 1000 }
    for (const devicePayload of [
      { version: 2, ...deviceLifetime },
      { version: 2, ...deviceLifetime, deviceId: '' },
      { version: 2, ...deviceLifetime, deviceId: 42 },
    ]) {
      expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', {
        cookie: signedCookie(store, name, devicePayload, 'v2'),
      }))).toBe(false)
    }

    const shorter = await createAuth(store, 1)
    expect(shorter.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(false)
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'))
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(false)
    vi.setSystemTime(new Date('2026-08-23T00:00:00.000Z'))
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(false)
  })

  it('loads one secret per activation and replaces it after deletion on the next activation', async () => {
    const store = new RecordCredentials()
    const auth = await createAuth(store)
    const first = exchange(auth)
    expect(store).toMatchObject({ reads: 1, modifies: 1 })

    await store.deleteRecord()
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: first.cookie }))).toBe(true)
    const sameActivation = exchange(auth)
    expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: sameActivation.cookie }))).toBe(true)
    expect(store).toMatchObject({ reads: 1, modifies: 1 })

    const reactivated = await createAuth(store)
    const second = exchange(reactivated)
    expect(second.cookie).not.toBe(first.cookie)
    expect(reactivated.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: first.cookie }))).toBe(false)
    expect(reactivated.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: second.cookie }))).toBe(true)
    expect(store).toMatchObject({ reads: 2, modifies: 2 })
  })

  it('fails loud on an invalid owner record instead of replacing it', async () => {
    const unsupported = new RecordCredentials()
    unsupported.record = { kind: 'api-key', key: 'not-a-cookie-secret' }
    await expect(createAuth(unsupported)).rejects.toThrow(/unsupported format/u)

    const malformed = new RecordCredentials()
    malformed.record = { kind: 'grant', payload: { version: 1, secret: 'short' } }
    await expect(createAuth(malformed)).rejects.toThrow(/invalid secret/u)

    const nonString = new RecordCredentials()
    nonString.record = { kind: 'grant', payload: { version: 1, secret: 42 } }
    await expect(createAuth(nonString)).rejects.toThrow(/invalid secret/u)

    const discarded = new RecordCredentials()
    discarded.discardWrites = true
    await expect(createAuth(discarded)).rejects.toThrow(/was not created/u)

    await expect(createAuth(new RecordCredentials(), Number.MAX_SAFE_INTEGER))
      .rejects.toThrow(/safe timestamp range/u)
  })

  describe('device cookies', () => {
    it('exchanges the launch token and accepts its cookie on loopback only', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-12T12:00:00.000Z'))
      const store = new RecordCredentials()
      const auth = await createAuth(store)
      const lanAuthority = '192.168.0.126:3080'

      const launch = new URL(auth.authenticatedUrl(`http://${lanAuthority}`))
      const refused = response()
      expect(auth.authorizeIndex(
        request(`${launch.pathname}${launch.search}`, lanAuthority),
        refused.value,
      )).toBe(false)
      expect(refused.state).toMatchObject({ status: 401 })
      expect(refused.state.headers?.['set-cookie']).toBeUndefined()

      // A launch-token cookie that exists for a LAN authority — a phone that
      // opened the printed LAN URL before this rule — buys nothing.
      const payload = {
        version: 1,
        authority: lanAuthority,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 1_000,
      }
      const forged = signedCookie(store, cookieNameFor(lanAuthority), payload)
      expect(auth.isAuthenticated(request('/', lanAuthority, { cookie: forged }))).toBe(false)

      // The same cookie shape is exactly what the computer's own browser holds.
      const loopbackExchange = exchange(auth)
      expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: loopbackExchange.cookie }))).toBe(true)
    })

    it('mints a v2 cookie bound to the authority and the configured device lifetime', async () => {
      const store = new RecordCredentials()
      store.setPairedDevices({ version: 1, devices: [deviceEntry('phone-1', 'HUAWEI JAD-AL50')] })
      const auth = await createAuth(store, 30, {}, 180)
      const setCookie = auth.issueDeviceCookie('192.168.0.126:3080', 'phone-1')

      expect(setCookie).toMatch(/; Max-Age=15552000; Path=\/; Expires=.*; HttpOnly; SameSite=Strict$/u)
      const pair = cookiePair(setCookie)
      expect(pair.startsWith('dsh-auth-')).toBe(true)
      expect(pair.split('=')[1]?.startsWith('v2.')).toBe(true)
      expect(auth.isAuthenticated(request('/', '192.168.0.126:3080', { cookie: pair }))).toBe(true)
      expect(auth.isAuthenticated(request('/', '192.168.0.127:3080', { cookie: pair }))).toBe(false)
      expect(auth.isAuthenticated(request('/', '192.168.0.126:3080', { cookie: `${pair}x` }))).toBe(false)
      expect(auth.isAuthenticated({ headers: { host: '192.168.0.126:3080' } })).toBe(false)
    })

    it('rejects a device cookie for an unregistered device and for one revoked after activation', async () => {
      const store = new RecordCredentials()
      const auth = await createAuth(store)
      const cookie = cookiePair(auth.issueDeviceCookie('127.0.0.1:3080', 'phone-1'))
      expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(false)

      store.setPairedDevices({ version: 1, devices: [deviceEntry('phone-1')] })
      await auth.refreshPairedDevices()
      expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(true)

      store.setPairedDevices({ version: 1, devices: [] })
      await auth.refreshPairedDevices()
      expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(false)
    })

    it('keeps the launch-token cookie valid while the device registry is empty', async () => {
      const store = new RecordCredentials()
      const auth = await createAuth(store)
      const login = exchange(auth)

      expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie: login.cookie }))).toBe(true)
      expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', {
        cookie: cookiePair(auth.issueDeviceCookie('127.0.0.1:3080', 'phone-1')),
      }))).toBe(false)
    })

    it('enforces the device lifetime of this activation', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-08-24T00:00:00.000Z'))
      const store = new RecordCredentials()
      store.setPairedDevices({ version: 1, devices: [deviceEntry('phone-1')] })
      const auth = await createAuth(store, 30, {}, 180)
      const cookie = cookiePair(auth.issueDeviceCookie('127.0.0.1:3080', 'phone-1'))
      expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(true)

      const shorter = await createAuth(store, 30, {}, 1)
      expect(shorter.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(false)

      vi.setSystemTime(new Date('2027-03-24T00:00:00.000Z'))
      expect(auth.isAuthenticated(request('/', '127.0.0.1:3080', { cookie }))).toBe(false)
    })

    it('fails loud on a malformed paired-device registry during activation', async () => {
      const store = new RecordCredentials()
      store.setPairedDevices({ version: 9, devices: [] })
      await expect(createAuth(store)).rejects.toThrow(/paired-devices/u)

      const tooLong = new RecordCredentials()
      store.setPairedDevices({ version: 1, devices: [] })
      await expect(createAuth(tooLong, 30, {}, Number.MAX_SAFE_INTEGER))
        .rejects.toThrow(/safe timestamp range/u)
    })
  })
})
