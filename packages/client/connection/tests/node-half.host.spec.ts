/** Node half: registers the /api prefix route bridging to the api gateway. */
import { EventEmitter } from 'node:events'
import { createServer, request as httpRequest } from 'node:http'
import { Readable } from 'node:stream'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type { PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { IndexInjection, WebServer, WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { API_PATH, Config, RpcId, apply, inject, type ClientRequest, type ConnectionConfig, type HostConnectionHandle } from '../src/index.ts'
import { BrowserAuth } from '../src/browser-auth.ts'
import { PairedDeviceId } from '../src/device-brand.ts'
import { PAIRED_DEVICES_RECORD_KEY } from '../src/devices.ts'
import { DEFAULT_MAX_REQUEST_BODY_BYTES } from '../src/http-bridge.ts'
import { provideBrowserCredentials, RecordCredentials } from './browser-credentials.ts'

/** The Peer an index render speaks for; this listener reads no field of it. */
const PAGE_PEER = { principal: { kind: 'owner' } } as Parameters<WebServer['renderIndex']>[1]

/** Structural webServer fake recording both route registries. */
function fakeHttpServer(
  routes: WebRoute[],
  upgrades: WebUpgradeRoute[],
  host = '127.0.0.1',
  protocol: WebServer['protocol'] = 'http:',
): Pick<WebServer, 'register' | 'registerUpgrade' | 'tapIndex' | 'port' | 'host' | 'protocol'> {
  return {
    host,
    protocol,
    register(route: WebRoute) {
      if (routes.some(candidate => candidate.kind === route.kind && candidate.path === route.path)) {
        throw new Error(`duplicate route ${route.path}`)
      }
      routes.push(route)
      return () => { routes.splice(routes.indexOf(route), 1) }
    },
    registerUpgrade(route) {
      upgrades.push(route)
      return () => { upgrades.splice(upgrades.indexOf(route), 1) }
    },
    tapIndex: () => () => {},
    port: 0,
  }
}

/** Bodyless GET carrying the given headers (enough for the trust fence + bridge). */
function fakeRequest(headers: Record<string, string>, url = `${API_PATH}/session.list`): IncomingMessage {
  const request = Readable.from([]) as IncomingMessage
  Object.assign(request, { url, method: 'GET', headers, socket: { remoteAddress: '127.0.0.1' } })
  return request
}

/** JSON POST carrying a complete client-request envelope. */
function fakePost(headers: Record<string, string>, url: string, body: unknown): IncomingMessage {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]) as IncomingMessage
  Object.assign(request, { url, method: 'POST', headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } })
  return request
}

/** Raw POST for malformed-body and media-type boundary cases. */
function fakeRawPost(headers: Record<string, string>, url: string, body: string): IncomingMessage {
  const request = Readable.from([Buffer.from(body)]) as IncomingMessage
  Object.assign(request, { url, method: 'POST', headers, socket: { remoteAddress: '127.0.0.1' } })
  return request
}

/** Response recorder compatible with both the fence's short-circuit and the bridge. */
function fakeResponse(): {
  response: ServerResponse
  state: { status?: number; headers?: Record<string, string | string[]>; body?: unknown }
} {
  const state: { status?: number; headers?: Record<string, string | string[]>; body?: unknown } = {}
  const staged: Record<string, string | string[]> = {}
  const chunks: Buffer[] = []
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false,
    setHeader(name: string, value: string) {
      staged[name] = value
      return this
    },
    // The bridge forwards a staged renewal alongside the route's own cookies,
    // so the double answers the same read the real response does.
    getHeader(name: string) { return staged[name] },
    writeHead(value: number, headers?: Record<string, string | string[]>) {
      state.status = value
      // node:http sends headers staged with setHeader unless writeHead names them.
      state.headers = { ...staged, ...headers }
      return this
    },
    write(value: string | Uint8Array) { chunks.push(Buffer.from(value)); return true },
    end(this: { writableEnded: boolean }, value?: unknown) {
      if (typeof value === 'string' || value instanceof Uint8Array) chunks.push(Buffer.from(value))
      else if (value !== undefined) throw new TypeError('fake response only accepts string or Uint8Array bodies')
      if (chunks.length > 0) state.body = Buffer.concat(chunks).toString()
      this.writableEnded = true
      return this
    },
  }) as ServerResponse
  return { response, state }
}

async function mounted(
  config?: ConnectionConfig,
  protocol: WebServer['protocol'] = 'http:',
  options: { credentials?: CredentialProvider; host?: string } = {},
): Promise<{
  ctx: Context
  routes: WebRoute[]
  upgrades: WebUpgradeRoute[]
  connection: HostConnectionHandle
  store: RecordCredentials
  dispose: () => Promise<void>
}> {
  const ctx = new Context()
  const routes: WebRoute[] = []
  const upgrades: WebUpgradeRoute[] = []
  const store = new RecordCredentials()
  if (options.credentials === undefined) provideBrowserCredentials(ctx, store)
  else ctx.provide('credentials', options.credentials)
  ctx.provide('webServer', fakeHttpServer(routes, upgrades, options.host, protocol) as WebServer)
  const fiber = ctx.plugin({ inject: [...inject], apply }, config)
  await fiber.await()
  return {
    ctx,
    routes,
    upgrades,
    connection: ctx.get('connection') as HostConnectionHandle,
    store,
    dispose: () => fiber.dispose(),
  }
}

/** Exchange a service's process token for one authority-bound Cookie header. */
function browserCookie(connection: HostConnectionHandle, authority: string): string {
  const url = new URL(connection.authenticatedUrl(`http://${authority}`))
  const exchanged = fakeResponse()
  connection.authorizeIndex(
    fakeRequest({ host: authority }, `${url.pathname}${url.search}`),
    exchanged.response,
  )
  const setCookie = exchanged.state.headers?.['set-cookie']
  if (setCookie === undefined) throw new Error('browser token exchange did not set a cookie')
  return (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(';', 1)[0]!
}

/**
 * One accepted Cookie header for an authority: the launch-token exchange on
 * loopback, and a paired device's own cookie everywhere else — the process token
 * is a loopback credential.
 */
async function authorityCookie(connection: HostConnectionHandle, authority: string): Promise<string> {
  const hostname = new URL(`http://${authority}`).hostname
  if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]') {
    return browserCookie(connection, authority)
  }
  const device = await connection.devices.register({ label: 'test device' })
  const issued = connection.devices.issueCookie(fakeRequest({ host: authority }), device.id)
  if (issued === undefined) throw new Error('device cookie issuance produced no cookie')
  return issued.split(';', 1)[0]!
}

/** The paired-device entries the registry record currently holds. */
function storedDevices(store: RecordCredentials): readonly Record<string, unknown>[] {
  const record = store.keyed.get(String(PAIRED_DEVICES_RECORD_KEY))
  if (record?.kind !== 'grant') return []
  const payload: unknown = record.payload
  if (typeof payload !== 'object' || payload === null) return []
  const devices: unknown = Reflect.get(payload, 'devices')
  return Array.isArray(devices) ? devices as readonly Record<string, unknown>[] : []
}

describe('connection node half', () => {
  it('provides the carrier-neutral service without a Web server', async () => {
    const ctx = new Context()
    provideBrowserCredentials(ctx)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    try {
      await fiber.await()
      const connection = ctx.get('connection') as HostConnectionHandle
      const cookie = browserCookie(connection, 'localhost')
      expect(connection.admit(fakeRequest({ host: 'localhost', cookie }))).toEqual({ peer: connection.browserPeer })
    } finally {
      await fiber.dispose()
    }
  })

  it('accepts the bind address of a web carrier attached after Connection', async () => {
    const ctx = new Context()
    const routes: WebRoute[] = []
    const upgrades: WebUpgradeRoute[] = []
    provideBrowserCredentials(ctx)
    const fiber = ctx.plugin({ inject: [...inject], apply }, { trustedHosts: ['harness.example'] })
    try {
      await fiber.await()
      const connection = ctx.get('connection') as HostConnectionHandle
      ctx.provide('webServer', { ...fakeHttpServer(routes, upgrades), port: 3080 } as WebServer)
      expect(connection).toBeInstanceOf(Object)
      expect(connection.admit(fakeRequest({ host: '127.0.0.1:3080' }))).toEqual({ rejection: 401 })
    } finally {
      await fiber.dispose()
    }
  })

  it('injects validated browser recovery timing and withdraws it on disposal', async () => {
    const { ctx, dispose } = await mounted({ recovery: { generationReadyTimeoutMs: 25_000 } })
    try {
      const rows: IndexInjection[] = []
      ctx.emit('webserver/index-inject', rows, PAGE_PEER)
      expect(rows).toEqual([{
        kind: 'global', name: '__DSH_CONNECTION_RECOVERY__', value: {
          backoffBaseMs: 500, backoffFactor: 2, backoffMaxMs: 10_000,
          generationReadyWarnMs: 3_000, generationReadyTimeoutMs: 25_000,
        },
      }])
      await dispose()
      const after: IndexInjection[] = []
      ctx.emit('webserver/index-inject', after, PAGE_PEER)
      expect(after).toEqual([])
    } finally {
      await dispose()
    }
  })

  it.each([
    { recovery: { backoffBaseMs: 0 }, error: /backoffBaseMs/ },
    { recovery: { backoffFactor: NaN }, error: /backoffFactor.*finite/ },
  ])('rejects invalid recovery timing before acquiring Host resources: $recovery', async ({ recovery, error }) => {
    const ctx = new Context()
    await expect(apply(ctx, { recovery })).rejects.toThrow(error)
    expect(ctx.get('connection')).toBeUndefined()
  })

  it('reserves enough default carrier capacity for the 200 MiB image batch', () => {
    expect(DEFAULT_MAX_REQUEST_BODY_BYTES).toBe(300 * 1024 * 1024)
    expect(DEFAULT_MAX_REQUEST_BODY_BYTES).toBeGreaterThan(Math.ceil(200 * 1024 * 1024 * 4 / 3) + 1024 * 1024)
  })

  it('fails loud when the carrier cap cannot hold the configured image batch', async () => {
    const ctx = new Context()
    const routes: WebRoute[] = []
    ctx.provide('webServer', fakeHttpServer(routes, []) as WebServer)
    ctx.provide('attachments', {
      imageLimits: { maxMessageImageBytes: 20 * 1024 * 1024 },
    } as AttachmentStore)
    await expect(apply(ctx, { maxRequestBodyBytes: 1024 }))
      .rejects.toThrow(/must be at least .* aggregate image limit/)
    expect(routes).toHaveLength(0)
  })

  it('fails the load on a trustedHosts entry that is not a bare authority', async () => {
    const routes: WebRoute[] = []
    const upgrades: WebUpgradeRoute[] = []
    const ctx = new Context()
    provideBrowserCredentials(ctx)
    ctx.provide('webServer', fakeHttpServer(routes, upgrades) as WebServer)
    const fiber = ctx.plugin({ inject: [...inject], apply }, { trustedHosts: ['harness.internal/path'] })
    await expect(fiber).rejects.toThrow(/not a bare host\[:port\] authority/)
    expect(routes).toHaveLength(0)
    expect(upgrades).toHaveLength(0)
  })

  it('registers the API and connect HTTP routes and removes them with the fiber', async () => {
    const { routes, upgrades, dispose } = await mounted()
    expect(routes).toHaveLength(2)
    expect(routes[0]).toMatchObject({ kind: 'prefix', path: API_PATH })
    expect(upgrades).toHaveLength(0)
    await dispose()
    expect(routes).toHaveLength(0)
    expect(upgrades).toHaveLength(0)
  })

  it('refuses an untrusted Host on any /api path before the bridge runs', async () => {
    const { routes, dispose } = await mounted()
    const { response, state } = fakeResponse()
    await routes[0]!.handler(fakeRequest({
      host: 'harness.example', origin: 'http://harness.example', 'sec-fetch-site': 'same-origin',
    }), response)
    expect(state.status).toBe(403)
    expect(state.body).toBe('forbidden')
    await dispose()
  })

  it.each(['2001:db8::1', '[2001:db8::1]'])('uses the bound IPv6 authority and TLS declarations (%s)', async (host) => {
    const { routes, connection, dispose } = await mounted({ trustedHosts: ['harness.example:443'] }, 'https:', { host })
    try {
      const unpaired = fakeResponse()
      await routes[0]!.handler(fakeRequest({ host: '[2001:db8::1]:0' }), unpaired.response)
      expect(unpaired.state.status).toBe(401)

      const wrongPort = fakeResponse()
      await routes[0]!.handler(fakeRequest({ host: '[2001:db8::1]:444' }), wrongPort.response)
      expect(wrongPort.state.status).toBe(403)

      const token = new URL(connection.authenticatedUrl('https://harness.example/'))
      const trusted = fakeResponse()
      connection.authorizeIndex(fakeRequest({ host: 'harness.example' }, `/${token.search}`), trusted.response)
      expect(trusted.state.status).toBe(303)
      expect(trusted.state.headers?.['set-cookie']).toContain('; Secure')
    } finally {
      await dispose()
    }
  })

  it('requires the same browser session for every method on every trusted authority', async () => {
    const { routes, connection, dispose } = await mounted({ trustedHosts: ['harness.example'] })
    const methods = [
      'session/openWorkspacePath',
      'llm/discoverModels', 'skills/list', 'settings/openSettingsDocument',
    ]
    for (const method of methods) {
      const denied = fakeResponse()
      await routes[0]!.handler(fakeRequest({ host: 'harness.example' }, `${API_PATH}/${method}`), denied.response)
      expect([method, denied.state.status, denied.state.body]).toEqual([method, 401, 'unauthorized'])
    }

    const cookie = await authorityCookie(connection, 'harness.example')
    for (const method of methods) {
      const allowed = fakeResponse()
      await routes[0]!.handler(
        fakeRequest({ host: 'harness.example', cookie }, `${API_PATH}/${method}`),
        allowed.response,
      )
      expect([method, allowed.state.status]).toEqual([method, 404])
    }

    const forged = fakeResponse()
    await routes[0]!.handler(fakeRequest({ host: 'localhost:3080' }), forged.response)
    expect(forged.state).toMatchObject({ status: 401, body: 'unauthorized' })
    await dispose()
  })

  it('passes loopback and declared-authority requests through to the bridge', async () => {
    const { routes, connection, dispose } = await mounted({ trustedHosts: ['harness.example:3080', '192.168.1.5'] })
    // Loopback, no browser markers (curl shape): the fence passes; the carrier
    // answers 404 for a GET unary path — proof the bridge ran.
    const loopback = fakeResponse()
    await routes[0]!.handler(fakeRequest({
      host: '127.0.0.1:3080',
      cookie: browserCookie(connection, '127.0.0.1:3080'),
    }), loopback.response)
    expect(loopback.state.status).toBe(404)
    // An all-interfaces composition derives port-less LAN IP literals, which
    // pass markerless curl on any port; that authority authenticates devices.
    const lan = fakeResponse()
    await routes[0]!.handler(fakeRequest({
      host: '192.168.1.5:3080',
      cookie: await authorityCookie(connection, '192.168.1.5:3080'),
    }), lan.response)
    expect(lan.state.status).toBe(404)
    // Declared public authority, same-origin browser shape.
    const declared = fakeResponse()
    await routes[0]!.handler(fakeRequest({
      host: 'harness.example:3080',
      origin: 'http://harness.example:3080',
      'sec-fetch-site': 'same-origin',
      cookie: await authorityCookie(connection, 'harness.example:3080'),
    }), declared.response)
    expect(declared.state.status).toBe(404)
    await dispose()
  })

  it('records the credential a phone holds and renews it on the next /api request', async () => {
    const { routes, connection, store, dispose } = await mounted({ trustedHosts: ['192.168.1.5'] })
    try {
      const authority = '192.168.1.5:3080'
      const device = await connection.devices.register({ label: 'test device' })
      const issued = connection.devices.issueCookie(fakeRequest({ host: authority }), device.id)
      const cookie = issued?.split(';', 1)[0]
      expect(cookie).toBeDefined()

      // The window the phone was handed is what the registry records, so the
      // Connect-phone panel can report a lapsed credential instead of a window.
      await vi.waitFor(() => {
        expect(storedDevices(store)).toEqual([expect.objectContaining({ credentialExpiresAt: device.expiresAt })])
      })

      // Extending the window reaches a phone that is already in the application
      // on its next carrier call, not only on a later document load.
      await connection.devices.setLifetime(device.id, 90)
      const extended = (await connection.devices.list())[0]!.expiresAt
      const renewed = fakeResponse()
      await routes[0]!.handler(
        fakeRequest({ host: authority, cookie: cookie! }, `${API_PATH}/session.list`),
        renewed.response,
      )
      const setCookie = renewed.state.headers?.['set-cookie']
      // A repeated header travels as a list; one cookie arrives as one entry.
      expect(setCookie).toEqual([expect.stringMatching(/; Max-Age=777\d{4};/u)])
      const cookiePair = (Array.isArray(setCookie) ? setCookie[0]! : setCookie!).split(';', 1)[0]!
      await vi.waitFor(() => {
        expect(storedDevices(store)).toEqual([expect.objectContaining({ credentialExpiresAt: extended })])
      })

      // The aligned credential is not re-issued on every later call.
      const aligned = fakeResponse()
      await routes[0]!.handler(
        fakeRequest({ host: authority, cookie: cookiePair }, `${API_PATH}/session.list`),
        aligned.response,
      )
      expect(aligned.state).toMatchObject({ status: 404 })
      expect(aligned.state.headers?.['set-cookie']).toBeUndefined()
    } finally {
      await dispose()
    }
  })

  it('records an authenticated request from a paired phone as that device in use', async () => {
    const { routes, connection, store, dispose } = await mounted({ trustedHosts: ['192.168.1.5'] })
    try {
      const authority = '192.168.1.5:3080'
      const device = await connection.devices.register({ label: 'phone' })
      // A phone paired hours ago keeps using the application, so the pairing
      // handshake cannot stay the only write behind the panel's last-used time.
      const unused = Date.now() - 3 * 60 * 60 * 1000
      store.setPairedDevices({ version: 1, devices: [{ ...device, lastSeenAt: unused }] })
      expect((await connection.devices.list())[0]!.lastSeenAt).toBe(unused)

      const issued = connection.devices.issueCookie(fakeRequest({ host: authority }), device.id)
      const cookie = issued?.split(';', 1)[0]
      expect(cookie).toBeDefined()

      await routes[0]!.handler(
        fakeRequest({ host: authority, cookie: cookie! }, `${API_PATH}/session.list`),
        fakeResponse().response,
      )
      await vi.waitFor(async () => {
        expect((await connection.devices.list())[0]!.lastSeenAt).toBeGreaterThan(unused)
      })
    } finally {
      await dispose()
    }
  })

  it('reports a last-seen write that failed instead of failing the request', async () => {
    const { ctx, routes, connection, store, dispose } = await mounted({ trustedHosts: ['192.168.1.5'] })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    try {
      const authority = '192.168.1.5:3080'
      const device = await connection.devices.register({ label: 'phone' })
      const cookie = connection.devices.issueCookie(fakeRequest({ host: authority }), device.id)!.split(';', 1)[0]!

      // A record this build cannot interpret fails the write while the cached
      // device set still authenticates the request.
      store.setPairedDevices({ version: 99, devices: [] })
      const answered = fakeResponse()
      await routes[0]!.handler(
        fakeRequest({ host: authority, cookie }, `${API_PATH}/session.list`),
        answered.response,
      )

      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledWith(
          'connection: could not record the last-seen time of device "%s": %s',
          device.id,
          expect.stringContaining('unsupported format'),
        )
      })
    } finally {
      warn.mockRestore()
      await dispose()
    }
  })

  it('shares its configured trust and authentication policy with sibling routes', async () => {
    const { connection, dispose } = await mounted({ trustedHosts: ['harness.example'] })
    const loopback = fakeRequest({ host: '127.0.0.1:3080' })
    const declared = fakeRequest({ host: 'harness.example' })

    expect(connection.requestRejection(loopback)).toBe(401)
    expect(connection.requestRejection(declared)).toBe(401)
    expect(connection.requestRejection(fakeRequest({
      host: 'harness.example',
      cookie: await authorityCookie(connection, 'harness.example'),
    }))).toBeUndefined()
    await dispose()
  })

  it('applies the configured carrier cap to a dedicated RPC channel', async () => {
    const { routes, connection, dispose } = await mounted({ maxRequestBodyBytes: 512 })
    try {
      const calls: unknown[] = []
      connection.rpc.handle('/rpc', async (endpoint, payload) => {
        calls.push({ endpoint, payload })
        return { ok: true, value: null }
      })
      const route = routes.find(candidate => candidate.path === '/rpc')!
      const cookie = await authorityCookie(connection, '127.0.0.1:3080')
      const envelope = (padding: number): ClientRequest => ({
        type: 'client-request',
        rpcId: RpcId('rpc-cap'),
        method: 'goals/create',
        payload: { args: { pad: 'x'.repeat(padding) } },
      })

      // The cap a deployment configures is the one that bounds every buffered
      // carrier of this activation, not only the shared /api route.
      const over = fakeResponse()
      await route.handler(fakePost({
        host: '127.0.0.1:3080',
        cookie,
      }, '/rpc/goals/create', envelope(4096)), over.response)
      expect(over.state.status).toBe(413)
      expect(calls).toEqual([])

      const within = fakeResponse()
      await route.handler(fakePost({
        host: '127.0.0.1:3080',
        cookie,
      }, '/rpc/goals/create', envelope(16)), within.response)
      expect(within.state.status).toBe(200)
      expect(calls).toHaveLength(1)
    } finally {
      await dispose()
    }
  })

  it('provides a disposable dedicated RPC channel', async () => {
    const ctx = new Context()
    const routes: WebRoute[] = []
    provideBrowserCredentials(ctx)
    ctx.provide('webServer', fakeHttpServer(routes, []) as WebServer)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(routes).toHaveLength(2)
    expect(routes[0]).toMatchObject({ kind: 'prefix', path: API_PATH })

    const connection = ctx.get('connection') as HostConnectionHandle
    const calls: unknown[] = []
    const remove = connection.rpc.handle('/rpc', async (endpoint, payload) => {
      calls.push({ endpoint, payload })
      return { ok: true, value: { accepted: true } }
    })
    const route = routes.find(candidate => candidate.path === '/rpc')
    expect(route).toBeDefined()

    const request: ClientRequest = {
      type: 'client-request',
      rpcId: RpcId('rpc-dedicated'),
      method: 'goals/create',
      payload: { args: { agentId: 'agent-1' } },
    }
    const result = fakeResponse()
    await route!.handler(fakePost({
      host: '127.0.0.1:3080',
      cookie: browserCookie(connection, '127.0.0.1:3080'),
    }, '/rpc/goals/create', request), result.response)
    expect(result.state.status).toBe(200)
    expect(JSON.parse(String(result.state.body))).toEqual({
      type: 'server-response',
      rpcId: 'rpc-dedicated',
      result: { ok: true, value: { accepted: true } },
    })
    expect(calls).toEqual([{
      endpoint: 'goals/create',
      payload: { args: { agentId: 'agent-1' } },
    }])

    expect(() => connection.rpc.handle('/rpc', async () => ({ ok: true, value: null })))
      .toThrow(/duplicate route/)
    await remove()
    expect(routes.map(candidate => candidate.path)).toEqual([API_PATH, '/connect'])
    await fiber.dispose()
    expect(routes).toHaveLength(0)
  })

  it('dispatches claimed /api endpoints and withdraws the claim', async () => {
    const ctx = new Context()
    const routes: WebRoute[] = []
    provideBrowserCredentials(ctx)
    ctx.provide('webServer', fakeHttpServer(routes, []) as WebServer)
    const fiber = ctx.plugin({ inject: [...inject], apply }, { trustedHosts: ['harness.example'] })
    await fiber.await()
    const connection = ctx.get('connection') as HostConnectionHandle
    const calls: unknown[] = []
    const remove = connection.rpc.intercept(
      '/api',
      endpoint => endpoint === 'goals/create',
      async (endpoint, payload) => {
        calls.push({ endpoint, payload })
        return { ok: true, value: { accepted: true } }
      },
    )
    expect(() => connection.rpc.intercept(
      '/api',
      () => true,
      async () => ({ ok: true, value: null }),
    )).toThrow('already has an interceptor')
    expect(() => connection.rpc.intercept(
      '/rpc' as '/api',
      () => true,
      async () => ({ ok: true, value: null }),
    )).toThrow('invalid shared RPC channel')
    const route = routes.find(candidate => candidate.path === API_PATH)!
    const request: ClientRequest = {
      type: 'client-request',
      rpcId: RpcId('rpc-shared'),
      method: 'goals/create',
      payload: { args: { agentId: 'agent-1' } },
    }

    const claimed = fakeResponse()
    const loopbackCookie = browserCookie(connection, '127.0.0.1:3080')
    await route.handler(fakePost({
      host: '127.0.0.1:3080', cookie: loopbackCookie,
    }, '/api/goals/create', request), claimed.response)
    expect(JSON.parse(String(claimed.state.body))).toEqual({
      type: 'server-response',
      rpcId: 'rpc-shared',
      result: { ok: true, value: { accepted: true } },
    })
    expect(calls).toEqual([{
      endpoint: 'goals/create',
      payload: { args: { agentId: 'agent-1' } },
    }])

    const denied = fakeResponse()
    await route.handler(fakePost({ host: 'other.example' }, '/api/goals/create', request), denied.response)
    expect(denied.state).toMatchObject({ status: 403, body: 'forbidden' })
    expect(calls).toHaveLength(1)

    const unclaimed = fakeResponse()
    await route.handler(fakeRequest({
      host: '127.0.0.1:3080', cookie: loopbackCookie,
    }, '/api/session.list'), unclaimed.response)
    expect(unclaimed.state.status).toBe(404)

    await remove()
    const withdrawn = fakeResponse()
    await route.handler(fakePost({
      host: '127.0.0.1:3080', cookie: loopbackCookie,
    }, '/api/goals/create', request), withdrawn.response)
    expect(withdrawn.state.status).toBe(404)
    expect(calls).toHaveLength(1)

    const removeAuthenticated = connection.rpc.intercept(
      '/api',
      endpoint => endpoint === 'goals/create',
      async () => ({ ok: true, value: null }),
    )
    const declared = fakeResponse()
    await route.handler(fakePost({
      host: 'harness.example',
      cookie: await authorityCookie(connection, 'harness.example'),
    }, '/api/goals/create', request), declared.response)
    expect(declared.state.status).toBe(200)
    await removeAuthenticated()
    await fiber.dispose()
  })

  it('admits every trusted, authenticated request as the owner browser Peer and hands each call that Peer', async () => {
    const { connection, routes, dispose } = await mounted({ trustedHosts: ['harness.example'] })
    const peers: PeerScope[] = []
    const remove = connection.rpc.intercept(
      '/api',
      () => true,
      async (_endpoint, _payload, _signal, peer) => {
        peers.push(peer)
        return { ok: true, value: null }
      },
    )
    expect(connection.admit(fakeRequest({ host: 'other.example' }))).toEqual({ rejection: 403 })
    expect(connection.admit(fakeRequest({ host: '127.0.0.1:3080' }))).toEqual({ rejection: 401 })
    const cookie = browserCookie(connection, '127.0.0.1:3080')
    expect(connection.admit(fakeRequest({ host: '127.0.0.1:3080', cookie }))).toEqual({ peer: connection.browserPeer })

    const route = routes.find(candidate => candidate.path === API_PATH)!
    const request: ClientRequest = {
      type: 'client-request',
      rpcId: RpcId('rpc-peer'),
      method: 'goals/create',
      payload: { args: {} },
    }
    const answered = fakeResponse()
    await route.handler(fakePost({ host: '127.0.0.1:3080', cookie }, '/api/goals/create', request), answered.response)
    expect(JSON.parse(String(answered.state.body))).toMatchObject({ result: { ok: true, value: null } })
    // A shell-owned carrier dispatches the shared handler without the bridge and speaks for the browser Peer too.
    const direct = await connection.createSharedFetchHandler('/api').fetch(new Request('http://127.0.0.1:3080/api/goals/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    }), connection.browserPeer)
    expect(direct.status).toBe(200)
    expect(peers).toEqual([connection.browserPeer, connection.browserPeer])
    expect(connection.browserPeer.principal).toEqual({ kind: 'owner' })

    // Racing disposals share one completion, and the scope goes with the Connection.
    await Promise.all([connection.browserPeer.dispose(), connection.browserPeer.dispose()])
    await remove()
    await dispose()
  })

  it('applies the configured trust fence and JSON envelope checks to generic channels', async () => {
    const ctx = new Context()
    const routes: WebRoute[] = []
    provideBrowserCredentials(ctx)
    ctx.provide('webServer', fakeHttpServer(routes, []) as WebServer)
    const fiber = ctx.plugin({ inject: [...inject], apply }, { trustedHosts: ['harness.example'] })
    await fiber.await()
    const connection = ctx.get('connection') as HostConnectionHandle
    const remove = connection.rpc.handle('/rpc', async (endpoint) => {
      if (endpoint === 'fail') throw new Error('handler broke')
      return { ok: true, value: null }
    })
    const route = routes.find(candidate => candidate.path === '/rpc')!
    const harnessHeaders = {
      host: 'harness.example',
      cookie: await authorityCookie(connection, 'harness.example'),
    }

    const denied = fakeResponse()
    await route.handler(fakePost({ host: 'other.example' }, '/rpc/goals/create', {}), denied.response)
    expect(denied.state).toMatchObject({ status: 403, body: 'forbidden' })

    const unauthenticated = fakeResponse()
    await route.handler(fakePost({ host: 'harness.example' }, '/rpc/goals/create', {}), unauthenticated.response)
    expect(unauthenticated.state).toMatchObject({ status: 401, body: 'unauthorized' })

    const methodMismatch = fakeResponse()
    await route.handler(fakePost(harnessHeaders, '/rpc/goals/create', {
      type: 'client-request', rpcId: 'rpc-bad', method: 'other', payload: {},
    }), methodMismatch.response)
    expect(JSON.parse(String(methodMismatch.state.body))).toMatchObject({
      rpcId: 'rpc-bad',
      result: { ok: false, error: { code: 'gateway/bad-request' } },
    })

    for (const [request, status] of [
      [fakeRequest(harnessHeaders, '/rpc/goals/create'), 404],
      [fakePost(harnessHeaders, '/outside/goals/create', {}), 404],
      [fakePost(harnessHeaders, '/rpc/goals//create', {}), 404],
      [fakeRawPost(harnessHeaders, '/rpc/goals/create', '{}'), 415],
      [fakeRawPost({ ...harnessHeaders, 'content-type': 'text/plain' }, '/rpc/goals/create', '{}'), 415],
      [fakeRawPost({ ...harnessHeaders, 'content-type': 'application/json; charset=utf-8' }, '/rpc/goals/create', '{'), 400],
    ] as const) {
      const response = fakeResponse()
      await route.handler(request, response.response)
      expect(response.state.status).toBe(status)
    }

    for (const [body, rpcId] of [
      [{ rpcId: 'retained-id' }, 'retained-id'],
      [{ rpcId: 42 }, 'invalid-request'],
      [null, 'invalid-request'],
    ] as const) {
      const response = fakeResponse()
      await route.handler(fakePost(harnessHeaders, '/rpc/goals/create', body), response.response)
      expect(JSON.parse(String(response.state.body))).toMatchObject({
        rpcId,
        result: { ok: false, error: { code: 'gateway/bad-request' } },
      })
    }

    const failed = fakeResponse()
    await route.handler(fakePost(harnessHeaders, '/rpc/fail', {
      type: 'client-request', rpcId: 'rpc-fail', method: 'fail', payload: {},
    }), failed.response)
    expect(failed.state).toMatchObject({ status: 500, body: 'handler failure: Error: handler broke' })

    expect(() => connection.rpc.handle('/api', async () => ({ ok: true, value: null })))
      .toThrow('invalid or reserved RPC channel')
    expect(() => connection.rpc.handle('api3', async () => ({ ok: true, value: null })))
      .toThrow('invalid or reserved RPC channel')
    await remove()
    await fiber.dispose()
  })
})

describe('operator-scoped connect', () => {
  async function connect(
    host: Awaited<ReturnType<typeof mounted>>,
    query = '',
    headers: Record<string, string> = {},
  ): Promise<{ cookie: string; state: ReturnType<typeof fakeResponse>['state'] }> {
    const token = new URL(host.connection.authenticatedUrl('http://localhost')).search
    const response = fakeResponse()
    await host.routes.find(route => route.path === '/connect')!.handler(
      fakeRequest({ host: 'localhost', ...headers }, `/connect${token}${query}`), response.response,
    )
    const cookie = response.state.headers?.['set-cookie']
    return { cookie: (Array.isArray(cookie) ? cookie[0] : cookie)?.split(';', 1)[0] ?? '', state: response.state }
  }

  function admitted(connection: HostConnectionHandle, cookie: string): PeerScope {
    const admission = connection.admit(fakeRequest({ host: 'localhost', cookie }))
    if ('rejection' in admission) throw new Error(`operator refused: ${admission.rejection}`)
    return admission.peer
  }

  it('defaults API callers to none regardless of Accept and honors explicit declarations', async () => {
    const host = await mounted()
    try {
      for (const [query, headers, interactions, status, location] of [
        ['', {}, 'none', 302, './api/remote.mux'],
        ['&interactions=none', {}, 'none', 302, './api/remote.mux'],
        ['&interactions=answer', {}, 'answer', 302, './api/remote.mux'],
        ['', { accept: 'text/html,application/xhtml+xml' }, 'none', 302, './api/remote.mux'],
        ['&interactions=answer', { accept: 'text/html' }, 'answer', 302, './api/remote.mux'],
      ] as const) {
        const result = await connect(host, query, headers)
        expect(result.state).toMatchObject({ status, headers: { location, 'cache-control': 'no-store' } })
        expect(admitted(host.connection, result.cookie).interactions).toBe(interactions)
      }
      const rootCookie = browserCookie(host.connection, 'localhost')
      expect(admitted(host.connection, rootCookie).interactions).toBe('answer')
    } finally { await host.dispose() }
  })

  it('keeps all browser cookies on the shared operator and creates independent API operators', async () => {
    const host = await mounted()
    try {
      const cookie = browserCookie(host.connection, 'localhost')
      expect(admitted(host.connection, cookie)).toBe(host.connection.browserPeer)
      expect(admitted(host.connection, browserCookie(host.connection, 'localhost'))).toBe(host.connection.browserPeer)
      const api = await connect(host, '', { cookie })
      expect(admitted(host.connection, api.cookie)).not.toBe(host.connection.browserPeer)
      const second = await connect(host, '', { cookie: api.cookie })
      expect(admitted(host.connection, second.cookie)).not.toBe(admitted(host.connection, api.cookie))
      const denied = fakeResponse()
      expect(host.connection.authorizeIndex(fakeRequest(
        { host: 'localhost', cookie: api.cookie }, '/',
      ), denied.response)).toBe('answered')
      expect(denied.state.status).toBe(401)
    } finally { await host.dispose() }
  })

  it('refuses invalid declarations, authentication, and untrusted connect requests without a cookie', async () => {
    const host = await mounted()
    try {
      for (const query of ['&interactions=observe', '&interactions=', '&interactions=none&interactions=answer']) {
        const result = await connect(host, query)
        expect(result.state.status).toBe(400)
        expect(result.cookie).toBe('')
      }
      for (const headers of [{ host: 'untrusted.example' }, { origin: 'http://untrusted.example' }]) {
        expect((await connect(host, '', headers)).state.status).toBe(403)
      }
      const route = host.routes.find(route => route.path === '/connect')!
      for (const request of [
        fakeRequest({ host: 'localhost' }, '/connect?token=invalid'),
        fakePost({ host: 'localhost' }, '/connect', {}),
      ]) {
        const response = fakeResponse()
        await route.handler(request, response.response)
        expect(response.state.status).toBe(401)
        expect(response.state.headers?.['set-cookie']).toBeUndefined()
      }
    } finally { await host.dispose() }
  })

  it('refuses a captured connect request after the owning fiber is disposed', async () => {
    const host = await mounted()
    try {
      const route = host.routes.find(candidate => candidate.path === '/connect')!
      const request = fakeRequest({ host: 'localhost' }, host.connection.authenticatedUrl('http://localhost/connect'))
      await host.dispose()
      const response = fakeResponse()

      await route.handler(request, response.response)

      expect(response.state).toMatchObject({ status: 401, body: 'unauthorized' })
      expect(response.response.writableEnded).toBe(true)
    } finally { await host.dispose() }
  })

  it('dispatches HTTP before a socket and lets an admitted call finish after socket release', async () => {
    const host = await mounted()
    const finish = Promise.withResolvers<undefined>()
    const started = Promise.withResolvers<AbortSignal>()
    try {
      const first = await connect(host)
      const second = await connect(host)
      const peer = admitted(host.connection, first.cookie)
      expect(admitted(host.connection, second.cookie).id).not.toBe(peer.id)
      host.connection.rpc.intercept('/api', () => true, async (_endpoint, _payload, signal, caller) => {
        expect(caller).toBe(peer)
        if (_endpoint === 'fixture/held') {
          started.resolve(signal)
          await finish.promise
        }
        return { ok: true, value: { id: caller.id } }
      })
      const api = host.routes.find(route => route.path === '/api')!
      const post = (method: string): IncomingMessage => fakePost({ host: 'localhost', cookie: first.cookie }, `/api/${method}`, {
        type: 'client-request', rpcId: 'connect-test', method, payload: {},
      })
      const beforeSocket = fakeResponse()
      await api.handler(post('fixture/now'), beforeSocket.response)
      expect(JSON.parse(String(beforeSocket.state.body))).toMatchObject({ result: { ok: true, value: { id: peer.id } } })

      const pendingResponse = fakeResponse()
      const pending = api.handler(post('fixture/held'), pendingResponse.response)
      const signal = await started.promise
      const owner = host.connection.admitConnection(fakeRequest({ host: 'localhost', cookie: first.cookie }))
      if ('rejection' in owner) throw new Error('first socket was refused')
      expect(owner.peer).toBe(peer)
      expect(host.connection.admitConnection(fakeRequest({ host: 'localhost', cookie: first.cookie })))
        .toEqual({ rejection: 409 })
      expect(admitted(host.connection, first.cookie)).toBe(peer)
      const cleanup = vi.fn()
      peer.ctx.effect(() => cleanup)
      const released = owner.release()
      expect(host.connection.admit(fakeRequest({ host: 'localhost', cookie: first.cookie }))).toEqual({ rejection: 401 })
      expect(owner.release()).toBe(released)
      await released
      expect(cleanup).toHaveBeenCalledOnce()
      expect(signal.aborted).toBe(false)
      finish.resolve(undefined)
      await pending
      expect(pendingResponse.state.status).toBe(200)
      const afterSocket = fakeResponse()
      await api.handler(post('fixture/now'), afterSocket.response)
      expect(afterSocket.state.status).toBe(401)
      expect(host.connection.admitConnection(fakeRequest({ host: 'localhost', cookie: first.cookie })))
        .toEqual({ rejection: 401 })
    } finally { finish.resolve(undefined); await host.dispose() }
  })

  it('retains unused operators for arbitrary elapsed time but rejects expired cookies', async () => {
    const host = await mounted({ cookieMaxAgeDays: 36_500 })
    vi.useFakeTimers()
    try {
      const { cookie } = await connect(host)
      const peer = admitted(host.connection, cookie)
      await vi.advanceTimersByTimeAsync(10 * 365 * 86_400_000)
      expect(admitted(host.connection, cookie)).toBe(peer)
      const disposed = vi.fn()
      peer.ctx.effect(() => disposed)
      await vi.advanceTimersByTimeAsync(100 * 365 * 86_400_000)
      expect(host.connection.admit(fakeRequest({ host: 'localhost', cookie }))).toEqual({ rejection: 401 })
      expect(disposed).not.toHaveBeenCalled()
      await host.dispose()
      expect(disposed).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers(); await host.dispose() }
  })

  it('preserves browser tabs and restart recovery without resurrecting API operators', async () => {
    const host = await mounted()
    const browser = { cookie: browserCookie(host.connection, 'localhost') }
    const api = await connect(host)
    const browserPeer = admitted(host.connection, browser.cookie)
    try {
      const request = fakeRequest({ host: 'localhost', cookie: browser.cookie })
      const one = host.connection.admitConnection(request)
      const two = host.connection.admitConnection(request)
      if ('rejection' in one || 'rejection' in two) throw new Error('browser tab was refused')
      expect(two.peer).toBe(one.peer)
      await one.release()
      expect(admitted(host.connection, browser.cookie)).toBe(browserPeer)
      await two.release()
      expect(admitted(host.connection, browser.cookie)).toBe(browserPeer)
      const refresh = fakeResponse()
      expect(host.connection.authorizeIndex(fakeRequest({ host: 'localhost', cookie: browser.cookie }, '/'), refresh.response)).toBe('serve')
      const cleanup = vi.fn()
      browserPeer.ctx.effect(() => cleanup)
      await host.dispose()
      expect(cleanup).toHaveBeenCalledOnce()
      expect(host.connection.admit(request)).toEqual({ rejection: 401 })
      const restarted = await mounted(undefined, 'http:', { credentials: host.ctx.credentials })
      try {
        expect(admitted(restarted.connection, browser.cookie)).toBe(restarted.connection.browserPeer)
        expect(admitted(restarted.connection, browser.cookie)).not.toBe(browserPeer)
        expect(restarted.connection.admit(fakeRequest({ host: 'localhost', cookie: api.cookie }))).toEqual({ rejection: 401 })
      } finally { await restarted.dispose() }
    } finally { await host.dispose() }
  })
})

describe('connection node half over a real HTTP server', () => {
  /** Serve the registered prefix route from a real server and return its port. */
  async function serve(routes: WebRoute[]): Promise<{ port: number; close: () => Promise<void> }> {
    const server = createServer((request, response) => {
      void routes[0]!.handler(request, response)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    return {
      port: address.port,
      close: () => new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined || error === null) resolve()
          else reject(error)
        })
      }),
    }
  }

  /** One real request; `host` spoofs the authority the way a LAN client's browser would send it. */
  function call(port: number, method: string, host: string, cookie?: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: `${API_PATH}/${method}`,
          method: 'GET',
          headers: { host, ...cookie === undefined ? {} : { cookie } },
        },
        (response) => {
          response.resume()
          response.on('end', () => { resolve(response.statusCode ?? 0) })
        },
      )
      request.on('error', reject)
      request.end()
    })
  }

  it('requires authentication uniformly over a real HTTP request', async () => {
    // A real IncomingMessage pins the exploit boundary: a client-controlled
    // Host naming loopback passes the rebinding fence but never authenticates.
    const { routes, connection, dispose } = await mounted({ trustedHosts: ['harness.example'] })
    const { port, close } = await serve(routes)
    try {
      const methods = [
        'settings/openSettingsDocument',
        'session/openWorkspacePath',
        'llm/discoverModels', 'skills/list',
        'llm/listProviders', 'session/modelCatalog',
      ]
      for (const method of methods) {
        expect([method, await call(port, method, 'localhost')]).toEqual([method, 401])
        expect([method, await call(port, method, 'harness.example')]).toEqual([method, 401])
      }
      expect(await call(port, 'settings/openSettingsDocument', 'other.example')).toBe(403)

      const declaredCookie = await authorityCookie(connection, 'harness.example')
      for (const method of methods) {
        expect([method, await call(port, method, 'harness.example', declaredCookie)]).toEqual([method, 404])
      }
      const loopbackAuthority = `127.0.0.1:${String(port)}`
      expect(await call(
        port,
        'settings/openSettingsDocument',
        loopbackAuthority,
        browserCookie(connection, loopbackAuthority),
      )).toBe(404)
    } finally {
      await close()
      await dispose()
    }
  })
})

describe('connection device registry handle', () => {
  it('registers a device and accepts its cookie without a restart, then bins, restores, and purges it', async () => {
    const { connection, dispose } = await mounted()
    const authority = '127.0.0.1:3080'
    try {
      const device = await connection.devices.register({ label: 'HUAWEI JAD-AL50' })
      expect(await connection.devices.list()).toEqual([device])

      const setCookie = connection.devices.issueCookie(fakeRequest({ host: authority }), device.id)
      expect(setCookie).toBeDefined()
      const cookie = setCookie!.split(';', 1)[0]!
      expect(connection.requestRejection(fakeRequest({ host: authority, cookie }))).toBeUndefined()
      // A device registered moments ago is inside the one-hour touch window.
      expect(await connection.devices.touch(device.id)).toBe(false)

      // Revocation bins the row: the cookie dies on the next request while the
      // entry stays listed with its revocation time.
      expect(await connection.devices.revoke(device.id)).toBe(true)
      const [binned] = await connection.devices.list()
      expect(binned).toMatchObject({ id: device.id, label: 'HUAWEI JAD-AL50' })
      expect(binned?.revokedAt).toBeDefined()
      expect(connection.requestRejection(fakeRequest({ host: authority, cookie }))).toBe(401)
      expect(await connection.devices.revoke(device.id)).toBe(false)

      // Deletion is bin-only; restore re-admits the same cookie.
      expect(await connection.devices.purge(device.id)).toBe(true)
      expect(await connection.devices.list()).toEqual([])
      expect(await connection.devices.restore(device.id)).toBe(false)
      expect(await connection.devices.purge(device.id)).toBe(false)

      const reregistered = await connection.devices.register({ label: 'HUAWEI JAD-AL50' })
      const revivedCookie = connection.devices.issueCookie(fakeRequest({ host: authority }), reregistered.id)!
        .split(';', 1)[0]!
      expect(await connection.devices.purge(reregistered.id)).toBe(false)
      expect(await connection.devices.revoke(reregistered.id)).toBe(true)
      expect(connection.requestRejection(fakeRequest({ host: authority, cookie: revivedCookie }))).toBe(401)
      expect(await connection.devices.restore(reregistered.id)).toBe(true)
      expect(connection.requestRejection(fakeRequest({ host: authority, cookie: revivedCookie }))).toBeUndefined()
    } finally {
      await dispose()
    }
  })

  it('mints no cookie for a request without a usable Host', async () => {
    const { connection, dispose } = await mounted()
    try {
      expect(connection.devices.issueCookie(fakeRequest({}), PairedDeviceId('device-1'))).toBeUndefined()
      expect(connection.devices.issueCookie({ headers: { host: 'bad host' } }, PairedDeviceId('device-1'))).toBeUndefined()
    } finally {
      await dispose()
    }
  })

  it('drops a device cookie when the credential record changes outside this service', async () => {
    const { ctx, connection, store, dispose } = await mounted()
    const authority = '127.0.0.1:3080'
    try {
      const device = await connection.devices.register({ label: 'HUAWEI JAD-AL50' })
      const setCookie = connection.devices.issueCookie(fakeRequest({ host: authority }), device.id)
      const cookie = setCookie!.split(';', 1)[0]!
      expect(connection.requestRejection(fakeRequest({ host: authority, cookie }))).toBeUndefined()

      // Another writer — an operator editing the file, or a second process —
      // clears the registry; the running Host honors that on the next request.
      store.setPairedDevices({ version: 1, devices: [] })
      ctx.emit('credentials/record-updated', PAIRED_DEVICES_RECORD_KEY)

      await vi.waitFor(() => {
        expect(connection.requestRejection(fakeRequest({ host: authority, cookie }))).toBe(401)
      })
    } finally {
      await dispose()
    }
  })

  it('serves the unauthenticated shell only for a trusted LAN authority', async () => {
    const { connection, dispose } = await mounted({ trustedHosts: ['192.168.0.122:3080'] })
    try {
      const trusted = fakeResponse()
      expect(connection.authorizeIndex(fakeRequest({ host: '192.168.0.122:3080' }, '/'), trusted.response)).toBe('auth-required')
      expect(trusted.state).toEqual({})
      const untrusted = fakeResponse()
      expect(connection.authorizeIndex(fakeRequest({ host: 'evil.example:3080' }, '/'), untrusted.response)).toBe('answered')
      expect(untrusted.state.status).toBe(401)
      expect(untrusted.state.headers?.['content-type']).toBe('text/plain; charset=utf-8')
    } finally {
      await dispose()
    }
  })

  it('requires a loopback peer and a launch cookie for operator requests', async () => {
    const { connection, dispose } = await mounted()
    try {
      for (const host of ['127.0.0.1:3080', 'localhost:3080', '[::1]:3080']) {
        const cookie = browserCookie(connection, host)
        const local = fakeRequest({ host, cookie })
        expect(connection.isLocalOperatorRequest(local)).toBe(true)
        Object.assign(local.socket, { remoteAddress: '192.168.0.122' })
        expect(connection.isLocalOperatorRequest(local)).toBe(false)
        expect(connection.isLocalOperatorRequest(fakeRequest({ host }))).toBe(false)
        const device = await connection.devices.register({ label: 'phone' })
        const deviceCookie = connection.devices.issueCookie(fakeRequest({ host }), device.id)!.split(';', 1)[0]!
        expect(connection.isLocalOperatorRequest(fakeRequest({ host, cookie: deviceCookie }))).toBe(false)
      }
      expect(connection.isLocalOperatorRequest(fakeRequest({ host: '192.168.0.126:3080' }))).toBe(false)
      expect(connection.isLocalOperatorRequest(fakeRequest({}))).toBe(false)
      expect(connection.isLocalOperatorRequest({ headers: { host: 'bad host' } })).toBe(false)
    } finally {
      await dispose()
    }
  })

  it('keeps the operator on a declared authority that has no loopback listener', async () => {
    const { connection, dispose } = await mounted(undefined, 'http:', { host: '192.168.0.126' })
    try {
      const authority = '192.168.0.126:3080'
      const cookie = browserCookie(connection, authority)
      const remote = fakeRequest({ host: authority, cookie })
      Object.assign(remote.socket, { remoteAddress: '192.168.0.122' })
      expect(connection.isLocalOperatorRequest(remote)).toBe(true)
      const device = await connection.devices.register({ label: 'phone' })
      const deviceCookie = connection.devices.issueCookie(fakeRequest({ host: authority }), device.id)!.split(';', 1)[0]!
      expect(connection.isLocalOperatorRequest(fakeRequest({ host: authority, cookie: deviceCookie }))).toBe(false)
    } finally {
      await dispose()
    }
  })

  it('redeems the launch token on the bound listener authority', async () => {
    const { ctx, connection, dispose } = await mounted()
    Object.assign(ctx.get('webServer')!, { host: '192.0.2.10', port: 3080 })
    try {
      const host = '192.0.2.10:3080'
      const cookie = browserCookie(connection, host)
      expect(connection.admit(fakeRequest({ host, cookie }))).toEqual({ peer: connection.operator })
    } finally {
      await dispose()
    }
  })

  it('refuses authenticated credentials without a caller identity', async () => {
    const { connection, dispose } = await mounted()
    try {
      const host = '127.0.0.1:3080'
      const device = await connection.devices.register({ label: 'phone' })
      const cookie = connection.devices.issueCookie(fakeRequest({ host }), device.id)!.split(';', 1)[0]!
      const classify = vi.spyOn(BrowserAuth.prototype, 'deviceIdOf').mockReturnValueOnce(undefined)
      try {
        expect(connection.admit(fakeRequest({ host, cookie }))).toEqual({ rejection: 401 })
      } finally {
        classify.mockRestore()
      }
    } finally {
      await dispose()
    }
  })

  it('admits a paired device as its own Peer, never as the operator', async () => {
    const { connection, routes, dispose } = await mounted()
    try {
      const host = '127.0.0.1:3080'
      const device = await connection.devices.register({ label: 'phone' })
      const deviceCookie = connection.devices.issueCookie(fakeRequest({ host }), device.id)!.split(';', 1)[0]!
      const operatorCookie = browserCookie(connection, host)
      // The launch-token credential is the operator's; the device cookie is a
      // device's even where the operator's own authority is granted, because
      // `accepts` admits a launch-token cookie only on a loopback peer.
      const operatorRequest = fakeRequest({ host, cookie: operatorCookie })
      const deviceRequest = fakeRequest({ host, cookie: deviceCookie })
      expect(connection.isLocalOperatorRequest(operatorRequest)).toBe(true)
      expect(connection.isLocalOperatorRequest(deviceRequest)).toBe(false)

      // The stream-mux upgrade calls exactly this pair (`admit`, then the Peer).
      const operatorAdmission = connection.admit(operatorRequest)
      const deviceAdmission = connection.admit(deviceRequest)
      expect(operatorAdmission).toEqual({ peer: connection.operator })
      if ('rejection' in deviceAdmission) throw new Error('the device credential was refused')
      // Handing the device the operator Peer is the regression this forbids: the
      // two identities must differ, so operator-scoped registrations and the
      // operator's stream lifetime never cover a paired device.
      expect(deviceAdmission.peer).not.toBe(connection.operator)
      expect(deviceAdmission.peer.id).not.toBe(connection.operator.id)
      expect(scopeOf(deviceAdmission.peer.ctx)).toBe(deviceAdmission.peer)
      expect(scopeOf(connection.operator.ctx)).toBe(connection.operator)

      // The RPC interceptor receives the request's own Peer, not one constant.
      const seen: PeerScope[] = []
      const interceptor = connection.rpc.intercept(
        '/api',
        endpoint => endpoint === 'device.peer',
        async (_endpoint, _payload, _signal, peer) => {
          seen.push(peer)
          return { ok: true, value: null }
        },
      )
      const envelope: ClientRequest = {
        type: 'client-request',
        rpcId: RpcId('peer-1'),
        method: 'device.peer',
        payload: {},
      }
      const route = routes.find(candidate => candidate.path === API_PATH)!
      const answer = fakeResponse()
      await route.handler(fakePost({ host, cookie: operatorCookie }, `${API_PATH}/device.peer`, envelope), answer.response)
      const deviceAnswer = fakeResponse()
      await route.handler(fakePost({ host, cookie: deviceCookie }, `${API_PATH}/device.peer`, envelope), deviceAnswer.response)
      await interceptor()
      expect(answer.state.status).toBe(200)
      expect(deviceAnswer.state.status).toBe(200)
      expect(seen[0]).toBe(connection.operator)
      expect(seen[1]).toBe(deviceAdmission.peer)
      expect(seen[1]).not.toBe(connection.operator)

      // Revocation closes the device's scope: the registrations it owns end, and
      // the next admitted request from a restored device mints a fresh Peer.
      let closed = false
      deviceAdmission.peer.ctx.effect(() => () => { closed = true })
      expect(await connection.devices.revoke(device.id)).toBe(true)
      await vi.waitFor(() => { expect(closed).toBe(true) })
    } finally {
      await dispose()
    }
  })

  it('gives a newly registered device the configured default window', async () => {
    const fallback = await mounted()
    try {
      const device = await fallback.connection.devices.register({ label: 'HUAWEI JAD-AL50' })
      expect(device.lifetimeDays).toBe(1)
      expect(device.expiresAt).toBeGreaterThan(Date.now())
    } finally {
      await fallback.dispose()
    }

    const configured = await mounted({ deviceLifetimeDays: 60 })
    try {
      const device = await configured.connection.devices.register({ label: 'HUAWEI JAD-AL50' })
      expect(device.lifetimeDays).toBe(60)
      const [listed] = await configured.connection.devices.list()
      expect(listed).toEqual(device)
    } finally {
      await configured.dispose()
    }
  })

  it('re-schedules one device window and mints its next cookie inside it', async () => {
    const { connection, dispose } = await mounted()
    const authority = '127.0.0.1:3080'
    // Only the clock is frozen, so the two minted windows stay exact while the
    // Context's own scheduling keeps running on real timers.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-13T12:00:00.000Z'))
    try {
      const device = await connection.devices.register({ label: 'HUAWEI JAD-AL50' })
      expect(connection.devices.issueCookie(fakeRequest({ host: authority }), device.id))
        .toContain('Max-Age=86400')

      expect(await connection.devices.setLifetime(device.id, 30)).toBe(true)
      const [listed] = await connection.devices.list()
      expect(listed?.lifetimeDays).toBe(30)
      expect(connection.devices.issueCookie(fakeRequest({ host: authority }), device.id))
        .toContain('Max-Age=2592000')

      expect(await connection.devices.setLifetime(PairedDeviceId('ghost'), 30)).toBe(false)
    } finally {
      vi.useRealTimers()
      await dispose()
    }
  })

  it('renames a device and refreshes the listed rows', async () => {
    const { connection, dispose } = await mounted()
    try {
      const device = await connection.devices.register({ label: 'HUAWEI JAD-AL50' })

      expect(await connection.devices.rename(device.id, '书房的平板')).toBe(true)
      const [listed] = await connection.devices.list()
      expect(listed?.label).toBe('书房的平板')

      expect(await connection.devices.rename(PairedDeviceId('ghost'), 'no such device')).toBe(false)
    } finally {
      await dispose()
    }
  })

  it('resolves the one-day device lifetime default and refuses a window outside 1–365 days', () => {
    expect(Config({}).deviceLifetimeDays).toBe(1)
    expect(() => Config({ deviceLifetimeDays: 0 })).toThrow()
    expect(() => Config({ deviceLifetimeDays: 366 })).toThrow()
    expect(Config({ deviceLifetimeDays: 365 }).deviceLifetimeDays).toBe(365)
  })
})
