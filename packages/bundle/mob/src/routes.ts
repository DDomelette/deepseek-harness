/**
 * The `/pair*` named routes: the phone's half of the handshake and the decisions
 * the computer makes. `/pair` and `/pair/state` are reachable without a session
 * cookie — the phone has none yet — but they still pass the Host fence and the
 * per-source throttling of {@link PairingSessions}. Every other route requires
 * a launch-token cookie and a loopback authority and TCP peer, so only the computer itself
 * can open a request, approve or deny it, or list, rename, reschedule, revoke,
 * restore, and purge devices.
 * @module @deepseek-ai/dsh-mob/src/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { PairedDeviceId } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { FrontendService } from '@deepseek-ai/dsh-host-frontend-static'
import { isPairingCode, PairingSessions } from './pairing.ts'
import type {} from './pairing.ts'
import type { ArpLookup } from './mac.ts'
import { resolveMacAddress } from './mac.ts'

/** Service name of the shell renderer, provided by `@deepseek-ai/dsh-host-frontend-static`. */
const FRONTEND_SERVICE = 'frontend'

/** Query parameter carrying the pairing code. */
const CODE_QUERY = 'c'
/** Largest accepted decision body; these routes carry only identifiers and a label. */
const PAIR_BODY_LIMIT_BYTES = 8 * 1024
/** Legal per-device lifetime in days, matching the Connection config schema. */
const MIN_DEVICE_LIFETIME_DAYS = 1
const MAX_DEVICE_LIFETIME_DAYS = 365
/** Longest accepted device label; the panel's rename input enforces the same bound. */
const MAX_DEVICE_LABEL_LENGTH = 64
/** Source recorded when the socket exposes no remote address (in-process callers). */
const UNKNOWN_SOURCE = 'unknown'

/** Paths of the pairing routes, one per handshake step. */
export const PAIR_PATHS = {
  screen: '/pair',
  state: '/pair/state',
  session: '/pair/session',
  requests: '/pair/requests',
  approve: '/pair/approve',
  devices: '/pair/devices',
  lifetime: '/pair/devices/lifetime',
  label: '/pair/devices/label',
  revoke: '/pair/revoke',
  restore: '/pair/devices/restore',
  purge: '/pair/devices/purge',
} as const

interface JsonHeaders {
  readonly [name: string]: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Write one complete response. */
function send(res: ServerResponse, status: number, body: string, headers: JsonHeaders): void {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers })
  res.end(body)
}

/** Write one JSON response. */
function sendJson(res: ServerResponse, status: number, value: unknown, headers: JsonHeaders = {}): void {
  send(res, status, `${JSON.stringify(value)}\n`, { 'content-type': 'application/json; charset=utf-8', ...headers })
}

/** Answer a route hit with the wrong method. */
function sendMethodNotAllowed(res: ServerResponse, allowed: string): void {
  res.writeHead(405, { allow: allowed, 'cache-control': 'no-store' })
  res.end()
}

/**
 * Read one JSON object body.
 * @param req - request whose body carries the decision.
 * @returns the parsed object, or undefined for an empty, oversized, or non-object body.
 */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buffer.byteLength
    if (size > PAIR_BODY_LIMIT_BYTES) return undefined
    chunks.push(buffer)
  }
  if (size === 0) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    // JSON.parse is the only statement here; a malformed body is a 400, not a plugin failure.
    return undefined
  }
  return isRecord(parsed) ? parsed : undefined
}

/** The pairing code a request carries in its query string. */
function codeOf(req: IncomingMessage): string | undefined {
  /* v8 ignore next -- node:http always supplies url on server requests. */
  const url = new URL(req.url ?? '/', 'http://dsh.invalid')
  const codes = url.searchParams.getAll(CODE_QUERY)
  const [code] = codes
  return codes.length === 1 && code !== undefined && isPairingCode(code) ? code : undefined
}

/**
 * Apply this route's access rule.
 * @param req - incoming request.
 * @param res - response owned when the request is refused.
 * @param ctx - plugin context carrying the Connection service.
 * @param access - `public` for the phone's two routes, `loopback` for the computer's.
 * @returns true when the caller must stop without touching the pairing state.
 */
function refused(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: Context,
  access: 'public' | 'loopback',
): boolean {
  const rejection = ctx.connection.requestRejection(req)
  if (rejection !== undefined && (rejection === 403 || access === 'loopback')) {
    res.writeHead(rejection, { 'cache-control': 'no-store' })
    res.end(rejection === 403 ? 'forbidden' : 'unauthorized')
    return true
  }
  if (access === 'loopback' && !ctx.connection.isLocalOperatorRequest(req)) {
    res.writeHead(403, { 'cache-control': 'no-store' })
    res.end('forbidden')
    return true
  }
  return false
}

/** The phone screen shell: the boot fact the pairing component reads, nothing else. */
function bootFact(code: string): string {
  const json = JSON.stringify({ code }).replaceAll('<', '\\u003c')
  return `<script>globalThis.__DSH_PAIR__ = ${json}</script>`
}

/**
 * The phone screen: the application shell carrying the pairing boot fact, so the
 * pairing component renders over the shell it already knows.
 * @param ctx - plugin context carrying the frontend service.
 * @param code - the code the phone claimed.
 * @returns the shell HTML, or undefined when this Host serves no application shell.
 */
async function pairingShell(ctx: Context, code: string): Promise<string | undefined> {
  const frontend = ctx.get(FRONTEND_SERVICE) as FrontendService | undefined
  if (frontend === undefined) return undefined
  const html = await frontend.renderIndex()
  return html.replace(/<head(?:\s[^>]*)?>/i, open => `${open}${bootFact(code)}`)
}

/**
 * Register the eleven pairing routes on the Host web server.
 * @param ctx - plugin context carrying `webServer` and the Connection service.
 * @param pairing - the process's pairing sessions.
 * @param lookup - ARP reader resolving an approved phone's MAC; tests inject
 * their own, the composition root leaves the platform default.
 * @returns disposer withdrawing every route.
 */
export function registerPairingRoutes(ctx: Context, pairing: PairingSessions, lookup?: ArpLookup): () => void {
  /**
   * Reclaim the registrations whose phones never collected a cookie: the code
   * expired while it still held one, and no device ever read it. The rows are
   * revoked and purged through the same rollback the approval's binding race
   * uses, so this layer's list never shows a device the operator believes is
   * paired.
   * @returns nothing; a failed reclamation is reported, never thrown at a route.
   */
  const reclaimUncollected = async (): Promise<void> => {
    for (const deviceId of pairing.sweepExpired()) {
      try {
        await ctx.connection.devices.revoke(deviceId)
        await ctx.connection.devices.purge(deviceId)
      } catch (error) {
        // The two device writes are the only statements that can throw here, and a
        // failed reclamation only leaves the row for the operator to revoke.
        ctx.logger.warn('mob: could not reclaim the uncollected device "%s": %s', deviceId, String(error))
      }
    }
  }

  /**
   * Register one loopback device-action route: a POST whose body carries the
   * device id and whose answer is the registry's verdict.
   * @param path - exact route path.
   * @param act - registry mutation the route applies.
   * @returns disposer withdrawing the route.
   */
  const deviceAction = (
    path: string,
    act: (devices: Context['connection']['devices'], deviceId: PairedDeviceId) => Promise<boolean>,
  ) => ctx.webServer.register({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendMethodNotAllowed(res, 'POST')
        return
      }
      if (refused(req, res, ctx, 'loopback')) return
      const body = await readJsonBody(req)
      const { deviceId } = body ?? {}
      if (typeof deviceId !== 'string') {
        sendJson(res, 400, { error: 'expected a device id' })
        return
      }
      // Wire boundary: the body carries the id as JSON text, and this is where
      // the validated string earns the registry's brand.
      sendJson(res, 200, { ok: await act(ctx.connection.devices, deviceId as PairedDeviceId) })
    },
  })

  const disposers = [
    ctx.webServer.register({
      kind: 'exact',
      path: PAIR_PATHS.screen,
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendMethodNotAllowed(res, 'GET, HEAD')
          return
        }
        if (refused(req, res, ctx, 'public')) return
        const code = codeOf(req)
        if (code === undefined) {
          sendJson(res, 400, { error: 'expected one eight-character pairing code' })
          return
        }
        const agent = req.headers['user-agent']
        if (typeof agent === 'string') {
          pairing.recordAgent(code, agent, req.socket.remoteAddress ?? UNKNOWN_SOURCE)
        }
        const shell = await pairingShell(ctx, code)
        if (shell === undefined) {
          sendJson(res, 503, { error: 'this Host serves no application shell' })
          return
        }
        send(res, 200, req.method === 'HEAD' ? '' : shell, { 'content-type': 'text/html; charset=utf-8' })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: PAIR_PATHS.state,
      handler: (req, res) => {
        if (req.method !== 'GET') {
          sendMethodNotAllowed(res, 'GET')
          return
        }
        if (refused(req, res, ctx, 'public')) return
        const code = codeOf(req)
        if (code === undefined) {
          sendJson(res, 400, { error: 'expected one eight-character pairing code' })
          return
        }
        const state = pairing.stateOf(code, req.socket.remoteAddress ?? UNKNOWN_SOURCE)
        if (state.status !== 'approved') {
          sendJson(res, 200, state)
          return
        }
        const setCookie = ctx.connection.devices.issueCookie(req, state.deviceId)
        if (setCookie === undefined) {
          sendJson(res, 400, { error: 'unusable request authority' })
          return
        }
        pairing.consume(code)
        sendJson(res, 200, { status: 'approved' }, { 'set-cookie': setCookie })
        // Last-seen bookkeeping is owed after the cookie is handed out, so the
        // phone never waits on a credential write; a failed write is reported
        // instead of becoming an unhandled rejection that ends the Host.
        void ctx.connection.devices.touch(state.deviceId).catch((error: unknown) => {
          ctx.logger.warn('mob: could not record the last-seen time of device "%s": %s', state.deviceId, String(error))
        })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: PAIR_PATHS.session,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendMethodNotAllowed(res, 'POST')
          return
        }
        if (refused(req, res, ctx, 'loopback')) return
        // Opening a code is the operator's signal that pairing is in use again,
        // which is when a row no phone collected must stop being listed.
        await reclaimUncollected()
        sendJson(res, 200, pairing.openSession())
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: PAIR_PATHS.requests,
      handler: (req, res) => {
        if (req.method !== 'GET') {
          sendMethodNotAllowed(res, 'GET')
          return
        }
        if (refused(req, res, ctx, 'loopback')) return
        sendJson(res, 200, { requests: pairing.pending() })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: PAIR_PATHS.approve,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendMethodNotAllowed(res, 'POST')
          return
        }
        if (refused(req, res, ctx, 'loopback')) return
        const body = await readJsonBody(req)
        const { code, label, allowed } = body ?? {}
        if (typeof code !== 'string' || !isPairingCode(code) || typeof label !== 'string' || typeof allowed !== 'boolean') {
          sendJson(res, 400, { error: 'expected a pairing code, a device label, and a decision' })
          return
        }
        const decision = pairing.approve(code, label, allowed)
        if (!decision.ok) {
          const status = decision.reason === 'unknown' ? 404 : decision.reason === 'expired' ? 410 : 409
          sendJson(res, status, { error: decision.reason })
          return
        }
        if (!allowed) {
          sendJson(res, 200, { ok: true })
          return
        }
        // Register first, publish second: the phone collects an approval only
        // once the device its cookie names exists. The claiming phone just
        // talked to us, so the ARP table can still name its hardware address;
        // a failed lookup stores no MAC rather than failing the approval.
        const source = pairing.sourceOf(code)
        const macAddress = source === undefined ? undefined : await resolveMacAddress(source, lookup)
        const device = await ctx.connection.devices.register(
          macAddress === undefined ? { label } : { label, macAddress },
        )
        if (!pairing.bindDevice(code, device.id)) {
          // The code expired, or another read settled it, while the row was
          // being written: bin and purge the row rather than list a device no
          // phone holds; deletion is bin-only, so both steps are owed.
          await ctx.connection.devices.revoke(device.id)
          await ctx.connection.devices.purge(device.id)
          sendJson(res, 410, { error: 'expired' })
          return
        }
        sendJson(res, 200, { ok: true, device })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: PAIR_PATHS.devices,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          sendMethodNotAllowed(res, 'GET')
          return
        }
        if (refused(req, res, ctx, 'loopback')) return
        // A code that expired with its registration uncollected is reclaimed
        // before the list is read, so this response never shows that row.
        await reclaimUncollected()
        sendJson(res, 200, { devices: await ctx.connection.devices.list() })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: PAIR_PATHS.lifetime,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendMethodNotAllowed(res, 'POST')
          return
        }
        if (refused(req, res, ctx, 'loopback')) return
        const body = await readJsonBody(req)
        const { deviceId, days } = body ?? {}
        if (typeof deviceId !== 'string' || typeof days !== 'number'
          || !Number.isSafeInteger(days) || days < MIN_DEVICE_LIFETIME_DAYS || days > MAX_DEVICE_LIFETIME_DAYS) {
          sendJson(res, 400, { error: 'expected a device id and a lifetime of 1 to 365 days' })
          return
        }
        // Wire boundary: the body carries the id as JSON text, and this is where
        // the validated string earns the registry's brand.
        const target = deviceId as PairedDeviceId
        sendJson(res, 200, { ok: await ctx.connection.devices.setLifetime(target, days) })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: PAIR_PATHS.label,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendMethodNotAllowed(res, 'POST')
          return
        }
        if (refused(req, res, ctx, 'loopback')) return
        const body = await readJsonBody(req)
        const { deviceId, label } = body ?? {}
        if (typeof deviceId !== 'string' || typeof label !== 'string'
          || label.trim() === '' || label.length > MAX_DEVICE_LABEL_LENGTH) {
          sendJson(res, 400, { error: 'expected a device id and a non-empty label of at most 64 characters' })
          return
        }
        // Wire boundary: the body carries the id as JSON text, and this is where
        // the validated string earns the registry's brand.
        sendJson(res, 200, { ok: await ctx.connection.devices.rename(deviceId as PairedDeviceId, label.trim()) })
      },
    }),
    deviceAction(PAIR_PATHS.revoke, (devices, deviceId) => devices.revoke(deviceId)),
    deviceAction(PAIR_PATHS.restore, (devices, deviceId) => devices.restore(deviceId)),
    deviceAction(PAIR_PATHS.purge, (devices, deviceId) => devices.purge(deviceId)),
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}
