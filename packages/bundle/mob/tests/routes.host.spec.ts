/**
 * The `/pair*` routes: the phone's two cookie-less steps, the computer's
 * loopback-only decisions, and the device cookie an approval hands out.
 */

import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RegisterDeviceRequest } from '@deepseek-ai/dsh-client-connection'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { apply, name } from '../src/index.ts'
import { PairingSessions } from '../src/pairing.ts'
import { PAIR_PATHS, registerPairingRoutes } from '../src/routes.ts'

const COOKIE = 'dsh-auth-test=v2.payload.signature; Max-Age=15552000; Path=/; HttpOnly; SameSite=Strict'
const SOURCE = '192.168.0.122'

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.useRealTimers()
})

interface ConnectionOptions {
  /** Status the fence/auth seam returns; undefined means the request is accepted. */
  readonly rejection?: 401 | 403
  /** Whether the request arrived on a loopback authority. */
  readonly loopback?: boolean
  /** Whether device-cookie issuance reports an unusable request authority. */
  readonly noCookie?: boolean
}

interface Bench {
  readonly ctx: Context
  readonly routes: Map<string, WebRoute>
  readonly pairing: PairingSessions
  readonly registered: RegisterDeviceRequest[]
  readonly revoked: string[]
  readonly touched: string[]
  /** Serve one route call and decode the recorded response. */
  call(path: string, init?: {
    method?: string
    code?: string
    cookie?: string
    body?: unknown
    rawBody?: string
    source?: string
    userAgent?: string
    noSocket?: boolean
    /** Deliver the body as one Buffer chunk instead of one string chunk. */
    bufferChunks?: boolean
  }): Promise<{ status: number; headers: Record<string, string>; body: string }>
}

function bench(options: ConnectionOptions = {}): Bench {
  const ctx = new Context()
  contexts.push(ctx)
  const routes = new Map<string, WebRoute>()
  const registered: RegisterDeviceRequest[] = []
  const revoked: string[] = []
  const touched: string[] = []
  ctx.provide('webServer', {
    register(route: WebRoute) {
      routes.set(route.path, route)
      return () => { routes.delete(route.path) }
    },
  } as unknown as WebServer)
  ctx.provide('connection', {
    requestRejection: () => options.rejection,
    isLoopbackRequest: () => options.loopback ?? true,
    devices: {
      list: async () => registered.map((request, index) => ({
        id: `device-${String(index + 1)}`,
        label: request.label,
        registeredAt: 1,
        lastSeenAt: 1,
      })),
      register: async (request: RegisterDeviceRequest) => {
        registered.push(request)
        return { id: `device-${String(registered.length)}`, label: request.label, registeredAt: 1, lastSeenAt: 1 }
      },
      revoke: async (deviceId: string) => {
        revoked.push(deviceId)
        return true
      },
      touch: async (deviceId: string) => {
        touched.push(deviceId)
        return true
      },
      issueCookie: () => (options.noCookie === true ? undefined : COOKIE),
    },
  } as never)

  const pairing = new PairingSessions()
  registerPairingRoutes(ctx, pairing)

  return {
    ctx,
    routes,
    pairing,
    registered,
    revoked,
    touched,
    async call(path, init = {}) {
      const route = routes.get(path)
      if (route === undefined) throw new Error(`no route registered for ${path}`)
      const query = init.code === undefined ? '' : `?c=${encodeURIComponent(init.code)}`
      const body = init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body))
      const request = Readable.from(
        body === undefined ? [] : [init.bufferChunks === true ? Buffer.from(body) : body],
      ) as unknown as IncomingMessage
      Object.assign(request, {
        url: `${path}${query}`,
        method: init.method ?? 'GET',
        headers: {
          host: '127.0.0.1:3080',
          ...init.cookie === undefined ? {} : { cookie: init.cookie },
          ...init.userAgent === undefined ? {} : { 'user-agent': init.userAgent },
          ...body === undefined ? {} : { 'content-type': 'application/json' },
        },
        socket: { remoteAddress: init.noSocket === true ? undefined : init.source ?? SOURCE },
      })
      const state: { status: number; headers: Record<string, string> } = { status: 0, headers: {} }
      const chunks: Buffer[] = []
      const response = Object.assign(new EventEmitter(), {
        writableEnded: false,
        writeHead(value: number, headers?: Record<string, string>) {
          state.status = value
          state.headers = headers ?? {}
          return this
        },
        write(value: string | Uint8Array) {
          chunks.push(Buffer.from(value))
          return true
        },
        end(this: { writableEnded: boolean }, value?: string | Uint8Array) {
          if (value !== undefined) chunks.push(Buffer.from(value))
          this.writableEnded = true
          return this
        },
      }) as unknown as ServerResponse
      await route.handler(request, response)
      return { status: state.status, headers: state.headers, body: Buffer.concat(chunks).toString('utf8') }
    },
  }
}

/** Approve one code through the computer's route. */
async function approve(
  subject: Bench,
  code: string,
  decision: { label?: string; allowed?: boolean } = {},
): Promise<{ status: number; body: string }> {
  return await subject.call(PAIR_PATHS.approve, {
    method: 'POST',
    cookie: 'dsh-auth-test=session',
    body: { code, label: decision.label ?? 'HUAWEI JAD-AL50', allowed: decision.allowed ?? true },
  })
}

describe('pairing routes', () => {
  it('registers one route per handshake step and withdraws them with the fiber', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const routes = new Map<string, WebRoute>()
    ctx.provide('webServer', {
      register(route: WebRoute) {
        routes.set(route.path, route)
        return () => { routes.delete(route.path) }
      },
    } as unknown as WebServer)
    ctx.provide('connection', {
      requestRejection: () => undefined,
      isLoopbackRequest: () => true,
      devices: {
        list: async () => [],
        register: async () => ({ id: 'device-1', label: 'phone', registeredAt: 1, lastSeenAt: 1 }),
        revoke: async () => true,
        touch: async () => true,
        issueCookie: () => COOKIE,
      },
    } as never)

    const fiber = ctx.plugin({ name, apply })
    await fiber
    expect([...routes.keys()].sort()).toEqual(Object.values(PAIR_PATHS).sort())

    await fiber.dispose()
    expect([...routes.keys()]).toEqual([])
  })

  it('serves the phone screen without a cookie and refuses a fenced request', async () => {
    const subject = bench()
    const { code } = subject.pairing.openSession()

    const phoneOnly = bench({ rejection: 401 })
    const unauthenticated = phoneOnly.pairing.openSession()
    expect((await phoneOnly.call(PAIR_PATHS.screen, { code: unauthenticated.code })).status).toBe(200)
    expect(JSON.parse((await phoneOnly.call(PAIR_PATHS.state, { code: unauthenticated.code })).body))
      .toEqual({ status: 'pending' })
    expect((await phoneOnly.call(PAIR_PATHS.session, { method: 'POST' })).status).toBe(401)

    const screen = await subject.call(PAIR_PATHS.screen, {
      code,
      source: SOURCE,
      userAgent: 'Mozilla/5.0 (Linux; Android 10; JAD-AL50)',
    })
    expect(screen.status).toBe(200)
    expect(screen.headers['content-type']).toContain('text/html')
    expect(screen.body).toContain(`globalThis.__DSH_PAIR__ = {"code":"${code}"}`)
    expect(subject.pairing.pending()[0]?.userAgent).toBe('Mozilla/5.0 (Linux; Android 10; JAD-AL50)')

    expect((await subject.call(PAIR_PATHS.screen, { method: 'HEAD', code })).body).toBe('')
    expect((await subject.call(PAIR_PATHS.screen, {})).status).toBe(400)
    const wrongMethod = await subject.call(PAIR_PATHS.screen, { method: 'POST', code })
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.allow).toBe('GET, HEAD')

    const fenced = bench({ rejection: 403 })
    const refused = await fenced.call(PAIR_PATHS.screen, { code })
    expect(refused.status).toBe(403)
  })

  it('reports the phone state, throttles a searching source, and hands the cookie out once', async () => {
    const subject = bench()
    const { code } = subject.pairing.openSession()

    expect(JSON.parse((await subject.call(PAIR_PATHS.state, { code })).body)).toEqual({ status: 'pending' })
    expect(JSON.parse((await subject.call(PAIR_PATHS.state, { code: 'ZZZZZZZZ', source: 'searcher' })).body))
      .toEqual({ status: 'unknown' })
    for (let attempt = 0; attempt < 4; attempt++) {
      await subject.call(PAIR_PATHS.state, { code: 'YYYYYYYY', source: 'searcher' })
    }
    expect(JSON.parse((await subject.call(PAIR_PATHS.state, { code: 'YYYYYYYY', source: 'searcher' })).body))
      .toEqual({ status: 'locked' })
    expect((await subject.call(PAIR_PATHS.state, { method: 'POST', code })).status).toBe(405)
    expect((await subject.call(PAIR_PATHS.state, {})).status).toBe(400)

    await approve(subject, code)
    const collected = await subject.call(PAIR_PATHS.state, { code })
    expect(collected.status).toBe(200)
    expect(collected.headers['set-cookie']).toBe(COOKIE)
    expect(JSON.parse(collected.body)).toEqual({ status: 'approved' })
    expect(subject.touched).toEqual(['device-1'])
    expect(JSON.parse((await subject.call(PAIR_PATHS.state, { code })).body)).toEqual({ status: 'unknown' })
  })

  it('keeps session, request, device, and revoke routes on loopback with a session cookie', async () => {
    const subject = bench()
    expect((await subject.call(PAIR_PATHS.session, { method: 'POST', cookie: 'dsh-auth-test=session' })).status).toBe(200)

    const remote = bench({ rejection: 401 })
    expect((await remote.call(PAIR_PATHS.session, { method: 'POST' })).status).toBe(401)

    const authenticatedButLan = bench({ loopback: false })
    expect((await authenticatedButLan.call(PAIR_PATHS.session, { method: 'POST' })).status).toBe(403)
    expect((await authenticatedButLan.call(PAIR_PATHS.requests)).status).toBe(403)
    expect((await authenticatedButLan.call(PAIR_PATHS.devices)).status).toBe(403)
  })

  it('opens a session the computer can list and approve under an edited label', async () => {
    const subject = bench()
    const opened = await subject.call(PAIR_PATHS.session, { method: 'POST' })
    expect(opened.status).toBe(200)
    const { code, expiresAt } = JSON.parse(opened.body) as { code: string; expiresAt: number }
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/u)
    expect(expiresAt).toBeGreaterThan(Date.now())

    const listed = JSON.parse((await subject.call(PAIR_PATHS.requests)).body) as {
      requests: { code: string; openedAt: number; expiresAt: number; userAgent?: string }[]
    }
    expect(listed.requests).toHaveLength(1)
    expect(listed.requests[0]).toMatchObject({ code, expiresAt })
    expect(typeof listed.requests[0]?.openedAt).toBe('number')

    const decided = await approve(subject, code, { label: '客厅的手机' })
    expect(decided.status).toBe(200)
    expect(subject.registered).toEqual([{ label: '客厅的手机' }])
    expect(JSON.parse((await subject.call(PAIR_PATHS.devices)).body)).toEqual({
      devices: [{ id: 'device-1', label: '客厅的手机', registeredAt: 1, lastSeenAt: 1 }],
    })
    expect(JSON.parse((await subject.call(PAIR_PATHS.revoke, {
      method: 'POST',
      body: { deviceId: 'device-1' },
    })).body)).toEqual({ ok: true })
    expect(subject.revoked).toEqual(['device-1'])
  })

  it('denies without registering, and refuses unknown, expired, or repeated decisions', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T12:00:00.000Z'))
    const subject = bench()
    const denied = subject.pairing.openSession()
    expect((await approve(subject, denied.code, { allowed: false })).status).toBe(200)
    expect(subject.registered).toEqual([])
    expect(JSON.parse((await subject.call(PAIR_PATHS.state, { code: denied.code })).body)).toEqual({ status: 'denied' })
    expect((await approve(subject, denied.code)).status).toBe(409)

    expect((await approve(subject, 'ZZZZZZZZ')).status).toBe(404)

    const expiring = subject.pairing.openSession()
    vi.setSystemTime(new Date('2026-09-12T12:02:00.000Z'))
    expect((await approve(subject, expiring.code)).status).toBe(410)
  })

  it('rejects malformed decision bodies', async () => {
    const subject = bench()
    const { code } = subject.pairing.openSession()

    for (const body of [{}, { code }, { code, label: 'phone' }, { code, label: 'phone', allowed: 'yes' }]) {
      const response = await subject.call(PAIR_PATHS.approve, { method: 'POST', body })
      expect(response.status).toBe(400)
    }
    expect((await subject.call(PAIR_PATHS.approve, { method: 'POST', rawBody: 'not json', bufferChunks: true })).status)
      .toBe(400)
    expect((await subject.call(PAIR_PATHS.approve, { method: 'POST' })).status).toBe(400)
    expect((await subject.call(PAIR_PATHS.approve, { method: 'GET' })).status).toBe(405)
    expect((await subject.call(PAIR_PATHS.revoke, { method: 'POST', body: {} })).status).toBe(400)
    expect((await subject.call(PAIR_PATHS.revoke, { method: 'GET' })).status).toBe(405)
    expect(subject.registered).toEqual([])
  })

  it('answers the remaining guard, transport, and body edges', async () => {
    const subject = bench()
    const fenced = bench({ rejection: 403 })
    expect((await fenced.call(PAIR_PATHS.state, { code: 'ZZZZZZZZ' })).status).toBe(403)

    const cookieLess = bench({ noCookie: true })
    const opened = cookieLess.pairing.openSession()
    await approve(cookieLess, opened.code)
    expect((await cookieLess.call(PAIR_PATHS.state, { code: opened.code })).status).toBe(400)

    expect(JSON.parse((await subject.call(PAIR_PATHS.state, { code: 'ZZZZZZZZ', noSocket: true })).body))
      .toEqual({ status: 'unknown' })
    expect((await subject.call(PAIR_PATHS.session, { method: 'GET' })).status).toBe(405)
    expect((await subject.call(PAIR_PATHS.requests, { method: 'POST' })).status).toBe(405)
    expect((await subject.call(PAIR_PATHS.devices, { method: 'POST' })).status).toBe(405)
    expect((await subject.call(PAIR_PATHS.revoke, { method: 'POST' })).status).toBe(400)

    const lan = bench({ loopback: false })
    expect((await lan.call(PAIR_PATHS.approve, {
      method: 'POST',
      body: { code: 'ZZZZZZZZ', label: 'phone', allowed: true },
    })).status).toBe(403)
    expect((await lan.call(PAIR_PATHS.revoke, { method: 'POST', body: { deviceId: 'device-1' } })).status).toBe(403)

    for (const rawBody of ['[1,2]', '42', 'x'.repeat(9 * 1024)]) {
      expect((await subject.call(PAIR_PATHS.revoke, { method: 'POST', rawBody })).status).toBe(400)
    }
  })
})
