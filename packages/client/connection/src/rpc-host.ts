/** Host registry and HTTP adapter for generic Connection RPC channels. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import {
  RpcId,
  type ClientRequest,
  type RpcId as RpcIdType,
} from './rpc.ts'
import { clientRequestSchema } from './rpc-schema.ts'
import { bridge } from './http-bridge.ts'
import { isDeclaredAuthority, isTrustedApiRequest } from './api-request-trust.ts'
import { API_PATH } from './api-path.ts'
import { listDevices, purgeDevice, registerDevice, renameDevice, restoreDevice, revokeDevice, setDeviceLifetime, touchDevice } from './devices.ts'
import { requestAuthority } from './request-authority.ts'
import { ConnectionPeer } from './peer.ts'
import type { PairedDeviceId } from './device-brand.ts'
import type { BrowserAuth } from './browser-auth.ts'
import type {
  ConnectionIndexAccess,
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionFetchRoute,
  ConnectionFetchHandler,
  HostConnectionDevices,
  HostConnectionFetch,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcFailure,
  ConnectionRpcHandler,
  ConnectionRpcHandlerResult,
  ConnectionRequestRejection,
  ConnectionTrustRequest,
  HostConnectionHandle,
  HostConnectionRpc,
  PeerAdmission,
} from './rpc.ts'

const INVALID_REQUEST_RPC_ID = RpcId('invalid-request')
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

interface ConnectionRpcInterceptor {
  readonly matches: ConnectionRpcEndpointMatcher
  readonly handler: ConnectionRpcHandler
}

interface RegisteredFetchRoute {
  readonly methods: ReadonlySet<string>
  readonly requestBody: ConnectionFetchRoute['requestBody']
  readonly fetch: ConnectionFetchRoute['fetch']
}

interface ConnectionServerResponse {
  readonly type: 'server-response'
  readonly rpcId: RpcIdType
  readonly result: ConnectionRpcHandlerResult
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Connection transport and RPC registrations. */
    connection: HostConnectionHandle
  }
}

/** Host Connection service whose channel registrations belong to the caller fiber. */
export class HostConnectionService extends Service implements HostConnectionHandle {
  private readonly interceptors = new Map<string, ConnectionRpcInterceptor>()
  private readonly fetchRoutes = new Map<string, RegisteredFetchRoute>()
  /** The operator's Peer: one scope for every launch-token caller of this Connection. */
  private readonly operatorPeer: ConnectionPeer
  /** One Peer per paired device that has been admitted; a device keeps its own scope. */
  private readonly devicePeers = new Map<PairedDeviceId, ConnectionPeer>()

  /**
   * Provide the Host half over the active HTTP server.
   * @param ctx - owning Connection plugin context, which also carries the credential provider.
   * @param trustedHosts - deployment authorities accepted by the Host/Origin fence.
   * @param browserAuth - process token and persistent browser-session owner.
   * @param maxRequestBodyBytes - carrier cap every buffered route of this
   *   activation buffers under, `/api` and registered channels alike.
   */
  constructor(
    ctx: Context,
    private readonly trustedHosts: readonly string[],
    private readonly browserAuth: BrowserAuth,
    private readonly maxRequestBodyBytes: number,
  ) {
    super(ctx, 'connection')
    this.operatorPeer = new ConnectionPeer(ctx)
    ctx.effect(() => () => this.disposePeers(), 'client-connection: caller Peers')
  }

  /** The local operator's Peer; its scope lives as long as this Connection. */
  get operator(): PeerScope {
    return this.operatorPeer
  }

  /**
   * Admit one request as the caller its credential names, never as a broader
   * one: an accepted launch-token cookie is the loopback operator, and an
   * accepted paired-device cookie is that device's own Peer, so a device never
   * inherits the operator's scope.
   * @param request - request headers and the TCP peer observed by the server.
   * @returns the admitted caller's Peer, or the status refusing the request.
   */
  admit(request: ConnectionTrustRequest): PeerAdmission {
    const rejection = this.requestRejection(request)
    if (rejection !== undefined) return { rejection }
    if (this.browserAuth.isLocalOperator(request, this.redeemsToken)) return { peer: this.operatorPeer }
    const deviceId = this.browserAuth.deviceIdOf(request)
    if (deviceId !== undefined) return { peer: this.devicePeer(deviceId) }
    // `accepts` admits exactly the launch-token credential and device cookies,
    // so a request that is authenticated but belongs to neither class means a
    // credential was added without an authority class: fail rather than let it
    // inherit the operator's scope.
    /* v8 ignore next 2 -- the two accepted credential versions are exactly these classes. */
    throw new Error('connection: admitted request carries no authority class')
  }

  /** The admitted device's own Peer, minted on its first request. */
  private devicePeer(deviceId: PairedDeviceId): ConnectionPeer {
    const existing = this.devicePeers.get(deviceId)
    if (existing !== undefined) return existing
    const peer = new ConnectionPeer(this.ctx)
    this.devicePeers.set(deviceId, peer)
    return peer
  }

  /**
   * Close one device's Peer, ending the registrations and live streams that
   * speak for it; the next request from a restored device mints a fresh scope.
   */
  private async closeDevicePeer(deviceId: PairedDeviceId): Promise<void> {
    const peer = this.devicePeers.get(deviceId)
    if (peer === undefined) return
    this.devicePeers.delete(deviceId)
    await peer.dispose()
  }

  private async disposePeers(): Promise<void> {
    const devices = [...this.devicePeers.values()]
    this.devicePeers.clear()
    for (const peer of devices) await peer.dispose()
    await this.operatorPeer.dispose()
  }

  /** Paired-device registry; each mutation refreshes the cookie check in place. */
  get devices(): HostConnectionDevices {
    const credentials = this.ctx.credentials
    return {
      list: () => listDevices(credentials),
      register: async (request) => {
        const device = await registerDevice(credentials, request, this.browserAuth.deviceLifetimeDays)
        await this.browserAuth.refreshPairedDevices()
        return device
      },
      revoke: async (deviceId) => {
        const binned = await revokeDevice(credentials, deviceId)
        if (binned) {
          await this.browserAuth.refreshPairedDevices()
          // A revoked device stops authenticating on its next request; closing
          // its Peer is what ends the streams it already holds.
          await this.closeDevicePeer(deviceId)
        }
        return binned
      },
      restore: async (deviceId) => {
        const restored = await restoreDevice(credentials, deviceId)
        if (restored) await this.browserAuth.refreshPairedDevices()
        return restored
      },
      purge: async (deviceId) => {
        const removed = await purgeDevice(credentials, deviceId)
        if (removed) await this.browserAuth.refreshPairedDevices()
        return removed
      },
      rename: async (deviceId, label) => {
        const renamed = await renameDevice(credentials, deviceId, label)
        if (renamed) await this.browserAuth.refreshPairedDevices()
        return renamed
      },
      setLifetime: async (deviceId, days) => {
        const updated = await setDeviceLifetime(credentials, deviceId, days)
        if (updated) await this.browserAuth.refreshPairedDevices()
        return updated
      },
      touch: deviceId => touchDevice(credentials, deviceId),
      issueCookie: (request, deviceId) => {
        const authority = requestAuthority(request.headers)
        return authority === undefined
          ? undefined
          : this.browserAuth.issueDeviceCookie(authority, deviceId, this.servesTls())
      },
    }
  }

  /**
   * Re-read the paired-device registry, for a credential record that changed
   * outside this service's own mutations.
   * @returns nothing; the refreshed set is installed before it resolves.
   */
  async refreshDevices(): Promise<void> {
    await this.browserAuth.refreshPairedDevices()
  }

  /** Generic channel registry scoped to the Context reading this service. */
  get rpc(): HostConnectionRpc {
    const owner = this.ctx
    return {
      handle: (channel, handler) => this.register(owner, channel, handler),
      intercept: (channel, matches, handler) =>
        this.registerInterceptor(owner, channel, matches, handler),
    }
  }

  /** Exact Fetch-route registry scoped to the Context reading this service. */
  get fetch(): HostConnectionFetch {
    const owner = this.ctx
    return {
      register: route => this.registerFetchRoute(owner, route),
    }
  }

  /** Apply the configured Host/Origin fence, then browser authentication. */
  requestRejection(request: ConnectionTrustRequest): ConnectionRequestRejection {
    if (!isTrustedApiRequest(request, this.trustedHosts, this.boundAuthority())) return 403
    return this.browserAuth.isAuthenticated(request, this.redeemsToken) ? undefined : 401
  }

  /** The exact address this process bound, as a fence authority, when a listener is up. */
  private boundAuthority(): string | undefined {
    const webServer = this.ctx.get('webServer')
    return webServer === undefined ? undefined : `${webServer.host}:${String(webServer.port)}`
  }

  /**
   * Authenticate an index request through the process-token exchange or cookie.
   * The Host/Origin fence keeps the application shell away from an authority
   * this Host does not trust, so only a trusted client without a session is
   * told how to pair. A TLS listener mints `Secure` cookies, and the launch
   * token redeems on loopback plus every authority this deployment declared.
   */
  authorizeIndex(request: ConnectionIndexRequest, response: ConnectionIndexResponse): ConnectionIndexAccess {
    const access = this.browserAuth.authorizeIndex(request, response, this.servesTls(), this.redeemsToken)
    if (access !== 'auth-required' || isTrustedApiRequest(request, this.trustedHosts, this.boundAuthority())) return access
    this.browserAuth.refuseIndexInText(request, response)
    return 'answered'
  }

  /** Whether the listener carrying browser requests serves TLS. */
  private servesTls(): boolean {
    return this.ctx.get('webServer')?.protocol === 'https:'
  }

  /** Bound function form of {@link declaresAuthority}, for the browser-auth predicates. */
  private readonly redeemsToken = (authority: string, hostname: string): boolean => this.declaresAuthority(authority, hostname)

  /**
   * Whether the operator declared this authority: the address the launcher
   * bound, or a `--trusted-host` entry. An undeclared name stays refused, so a
   * token-bearing address a phone receives still grants that phone nothing.
   * @param authority - canonical `host:port` of the request redeeming the token.
   * @param hostname - hostname of that request.
   * @returns true when this authority redeems the process launch token.
   */
  private declaresAuthority(authority: string, hostname: string): boolean {
    const webServer = this.ctx.get('webServer')
    if (webServer !== undefined
      && (hostname === webServer.host || authority === `${webServer.host}:${String(webServer.port)}`)) {
      return true
    }
    return isDeclaredAuthority(authority, this.trustedHosts)
  }
  /** Add this process's launch token to the clean application URL. */
  authenticatedUrl(baseUrl: string): string {
    return this.browserAuth.authenticatedUrl(baseUrl)
  }

  /**
   * Note one authenticated request from a paired device: stage the aligned
   * cookie when its credential lags the registry window, so an extension the
   * operator makes reaches a phone holding the application open, and record the
   * device's last use — the pairing handshake is not the only moment a device is
   * visibly in use. Every authenticated request may carry either, and the
   * registry throttles the write, so a busy phone costs at most one credential
   * write an hour.
   * @param request - headers and TCP peer of an authenticated request.
   * @param response - response that will carry any replacement cookie.
   * @returns nothing; a fully aligned request and a launch-token request receive
   *   nothing, and a failed last-seen write is reported rather than thrown.
   */
  noteDeviceRequest(request: ConnectionTrustRequest, response: ConnectionIndexResponse): void {
    const renewed = this.browserAuth.renewedDeviceCookie(request, this.servesTls())
    if (renewed !== undefined) response.setHeader('set-cookie', renewed)
    const deviceId = this.browserAuth.deviceIdOf(request)
    if (deviceId === undefined) return
    void this.devices.touch(deviceId).catch((error: unknown) => {
      this.ctx.logger.warn('connection: could not record the last-seen time of device "%s": %s', deviceId, String(error))
    })
  }

  /** Whether the local operator's launch-token cookie authorizes device management. */
  isLocalOperatorRequest(request: ConnectionTrustRequest): boolean {
    return this.browserAuth.isLocalOperator(request, this.redeemsToken)
  }

  /**
   * Compose one shared-channel Fetch handler from exact routes and its interceptor.
   * @param channel - shared channel mounted by Connection.
   * @param peer - Peer the admitted request speaks for, from {@link admit}.
   * @returns Fetch handler that selects one owner or returns 404.
   */
  createSharedFetchHandler(
    channel: '/api',
    peer: PeerScope,
  ): ConnectionFetchHandler {
    return {
      requestBodyMode: ({ method, url }) => {
        const route = this.fetchRoutes.get(url.pathname)
        return route?.methods.has(method) === true ? route.requestBody : 'buffered'
      },
      fetch: (request) => {
        const pathname = new URL(request.url).pathname
        const route = this.fetchRoutes.get(pathname)
        if (route?.methods.has(request.method) === true) return route.fetch(request)
        const endpoint = endpointFromPath(channel, pathname)
        const interceptor = this.interceptors.get(channel)
        if (endpoint === undefined || interceptor === undefined || !interceptor.matches(endpoint)) {
          return Promise.resolve(new Response('not found', { status: 404 }))
        }
        return rpcFetchHandler(channel, interceptor.handler, peer).fetch(request)
      },
    }
  }

  private registerFetchRoute(
    owner: Context,
    route: ConnectionFetchRoute,
  ): () => Promise<void> {
    assertFetchRoute(route)
    const registered: RegisteredFetchRoute = {
      methods: new Set(route.methods),
      requestBody: route.requestBody,
      fetch: route.fetch,
    }
    return owner.effect(() => {
      if (this.fetchRoutes.has(route.path)) {
        throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} is already registered`)
      }
      this.fetchRoutes.set(route.path, registered)
      return () => { this.fetchRoutes.delete(route.path) }
    }, `client-connection: ${route.path} Fetch route`)
  }

  private register(
    owner: Context,
    channel: string,
    handler: ConnectionRpcHandler,
  ): () => Promise<void> {
    assertChannel(channel)
    // Read the cap once, at registration: the request handler must not depend on
    // a Context-resolved `this` for a limit the activation already fixed.
    const maxRequestBodyBytes = this.maxRequestBodyBytes
    const route: WebRoute = {
      kind: 'prefix',
      path: channel,
      handler: async (req, res) => {
        const admission = this.admit(req)
        if ('rejection' in admission) {
          res.writeHead(admission.rejection)
          res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        this.noteDeviceRequest(req, res)
        await bridge(req, res, rpcFetchHandler(channel, handler, admission.peer), maxRequestBodyBytes)
      },
    }
    return owner.effect(
      () => owner.webServer.register(route),
      `client-connection: ${channel} rpc channel`,
    )
  }

  private registerInterceptor(
    owner: Context,
    channel: string,
    matches: ConnectionRpcEndpointMatcher,
    handler: ConnectionRpcHandler,
  ): () => Promise<void> {
    if (channel !== API_PATH) {
      throw new Error(`connection: invalid shared RPC channel ${JSON.stringify(channel)}`)
    }
    const interceptor: ConnectionRpcInterceptor = { matches, handler }
    return owner.effect(() => {
      if (this.interceptors.has(channel)) {
        throw new Error(`connection: shared RPC channel ${JSON.stringify(channel)} already has an interceptor`)
      }
      this.interceptors.set(channel, interceptor)
      return () => {
        this.interceptors.delete(channel)
      }
    }, `client-connection: ${channel} rpc interceptor`)
  }
}

function rpcFetchHandler(
  channel: string,
  handler: ConnectionRpcHandler,
  peer: PeerScope,
): ConnectionFetchHandler {
  return {
    requestBodyMode: () => 'buffered',
    async fetch(request: Request): Promise<Response> {
      const endpoint = endpointFromPath(channel, new URL(request.url).pathname)
      if (request.method !== 'POST' || endpoint === undefined) {
        return new Response('not found', { status: 404 })
      }

      const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }

      const envelope = clientRequestSchema.safeParse(body)
      if (!envelope.success) {
        return invalidEnvelopeResponse(body, envelope.error.issues)
      }
      const message: ClientRequest = envelope.data
      if (message.method !== endpoint) {
        return errorResponse(message.rpcId, {
          code: 'gateway/bad-request',
          message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
          details: { issues: [] },
        })
      }

      try {
        const result = await handler(endpoint, message.payload, request.signal, peer)
        return fullResponse(message.rpcId, result)
      } catch (error) {
        return new Response(`handler failure: ${String(error)}`, { status: 500 })
      }
    },
  }
}

function invalidEnvelopeResponse(body: unknown, issues: readonly object[]): Response {
  const rawId = (body as { rpcId?: unknown } | null)?.rpcId
  const rpcId = typeof rawId === 'string' ? RpcId(rawId) : INVALID_REQUEST_RPC_ID
  return errorResponse(rpcId, {
    code: 'gateway/bad-request',
    message: 'invalid client-request message',
    details: { issues },
  })
}

function endpointFromPath(channel: string, pathname: string): string | undefined {
  if (!pathname.startsWith(`${channel}/`)) return undefined
  const endpoint = pathname.slice(channel.length + 1)
  const segments = endpoint.split('/')
  if (segments.some(segment =>
    segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
    return undefined
  }
  return endpoint
}

function errorResponse(rpcId: RpcIdType, error: ConnectionRpcFailure): Response {
  return fullResponse(rpcId, { ok: false, error })
}

function fullResponse(rpcId: RpcIdType, result: ConnectionRpcHandlerResult): Response {
  // This carrier frames JSON alone. A result that projects bytes would lose
  // them here, so refuse it instead of answering with `null` placeholders.
  if (result.ok && result.attachments !== undefined && result.attachments.length > 0) {
    throw new Error('connection: this transport carries no RPC attachments; serve bytes through an exact Fetch route')
  }
  const body: ConnectionServerResponse = { type: 'server-response', rpcId, result }
  return Response.json(body)
}

function assertChannel(channel: string): void {
  if (!CHANNEL_PATTERN.test(channel) || channel === '/api') {
    throw new Error(`connection: invalid or reserved RPC channel ${JSON.stringify(channel)}`)
  }
}

function assertFetchRoute(route: ConnectionFetchRoute): void {
  if (endpointFromPath(API_PATH, route.path) === undefined) {
    throw new Error(`connection: invalid exact Fetch route ${JSON.stringify(route.path)}`)
  }
  if (route.methods.length === 0) {
    throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} declares no methods`)
  }
  const methods = new Set(route.methods)
  if (methods.size !== route.methods.length) {
    throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} repeats a method`)
  }
  // Fetch forbids a body on GET and HEAD, so a route's declared mode must agree
  // with the methods it owns: the bridge can attach a body only for the others.
  const bodyCarrier = route.methods.find(method => method !== 'GET' && method !== 'HEAD')
  if (bodyCarrier === undefined && route.requestBody !== 'none') {
    throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} owns only GET and HEAD and must declare requestBody 'none'`)
  }
  if (bodyCarrier !== undefined && route.requestBody === 'none') {
    throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} owns ${bodyCarrier} and cannot declare requestBody 'none'`)
  }
}
