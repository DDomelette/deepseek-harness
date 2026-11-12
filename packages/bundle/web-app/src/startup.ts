/**
 * The web app's command-line provider: it parses the `dsh --profile web` flag
 * family (`--host`, `--port`, `--public-url`, `--trusted-host`, `--no-open`, TLS)
 * and its `--help` text, then provides the immutable values as
 * {@link WEB_STARTUP_SERVICE}. Ordinary rows inject that service before
 * reading it from lazy config.
 *
 * The same entry owns the persistent bind policy applied when the invocation
 * names no `--host`: its `bindMode`/`bindHost` Config fields are editable from
 * Settings → Connect phone, so a deployment can keep one address across
 * launches. `loopback` is the default; `auto` takes the address of the
 * interface the default route uses, which avoids the virtual adapters a plain
 * interface scan picks on a development machine.
 * @module @deepseek-ai/dsh-web-app/startup
 */

import { createSocket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { Command } from 'commander'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import { isWildcardHost, type TlsConfig } from '@deepseek-ai/dsh-host-webserver'
import { parsePublicUrl } from './public-url.ts'

/** Stable Cordis plugin name. */
export const name = 'web-startup'

/** Services required before the flags can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this ordinary plugin and injected by flag-configured rows. */
export const WEB_STARTUP_SERVICE = 'webStartup'

/** How the listener picks its bind address when the invocation names no `--host`. */
export type BindMode = 'loopback' | 'auto' | 'fixed'

/** The bind policy in force for this deployment. */
export interface BindValues {
  /** Policy that produced {@link BindValues.host}. */
  mode: BindMode
  /** Address the listener binds when the invocation named no `--host`. */
  host: string
}

/** Configurable fallback bind policy. */
export interface Config {
  /**
   * How a launch without `--host` chooses its address. `loopback` keeps the
   * server on this machine, `fixed` uses {@link Config.bindHost}, and `auto`
   * takes the address of the interface the default route uses, falling back to
   * {@link Config.bindHost} and then to this machine.
   */
  bindMode: Volatile<BindMode>
  /** Concrete local address `fixed` binds; `auto` uses it when detection finds nothing, and `loopback` ignores it. */
  bindHost: Volatile<string>
}

/** Validated fallback bind policy; both fields are editable from Settings. */
export const Config = z.object({
  bindMode: z.union([z.const('loopback'), z.const('auto'), z.const('fixed')]).default('loopback').volatile(),
  bindHost: z.string().default('').volatile(),
})

/** What the web rows read from {@link WEB_STARTUP_SERVICE}. */
export interface WebStartupValues {
  /** Whether this invocation opens the default browser after startup. */
  openBrowser: boolean
  /** `--host`, absent when the invocation did not name one. */
  host?: string
  /** `--port`, absent when the invocation did not name one. */
  port?: number
  /**
   * `--public-url`, absent when not specified: the advertised HTTP(S) root.
   * See [public deployments](../README.md#public-deployments).
   */
  publicUrl?: string
  /** Explicit `--trusted-host` authorities, in argument order. */
  trustedHosts: string[]
  /** Server certificate chain and unencrypted private key supplied together. */
  tls?: TlsConfig
  /** Fallback the listener binds when `--host` is absent. */
  bind: BindValues
}

/** The web flag family, as commander parsed it. */
interface WebOptions {
  host?: string
  open: boolean
  port?: string
  publicUrl?: string
  trustedHost?: string[]
  tlsCert?: string
  tlsKey?: string
}

/** Address a listener binds when no interface is named. */
const LOOPBACK_HOST = '127.0.0.1'

/** Port of the route probe; UDP sends no packet, so only the local address is read. */
const ROUTE_PROBE_PORT = 53

/** Public resolver the route probe names: any routed destination answers with the same local address. */
const ROUTE_PROBE_HOST = '223.5.5.5'

/**
 * Local address of the interface the operating system would use for outbound
 * traffic, or undefined when no route exists.
 * @returns the IPv4 source address of the default route.
 */
function defaultRouteAddress(): Promise<string | undefined> {
  const socket = createSocket('udp4')
  return new Promise((resolve) => {
    let settled = false
    const settle = (address: string | undefined): void => {
      if (settled) return
      settled = true
      socket.close()
      resolve(address)
    }
    socket.once('error', () => { settle(undefined) })
    socket.connect(ROUTE_PROBE_PORT, ROUTE_PROBE_HOST, () => {
      try {
        settle(socket.address().address)
      } catch (_unbound) {
        // A throwing address() means the socket never bound; the interface scan covers it.
        settle(undefined)
      }
    })
  })
}

/** First non-internal, non-link-local IPv4 address, for hosts with no default route. */
function scannedAddress(): string | undefined {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) return entry.address
    }
  }
  return undefined
}

/**
 * Address the listener binds under `auto`, or undefined when this machine has
 * no usable network interface. The route probe runs first because a machine
 * with virtual adapters (a Docker or VMware interface) lists them beside the
 * real one, and only the routing table says which address reaches the network.
 * @returns a local IPv4 address, preferring the default route's interface.
 */
export async function detectLanAddress(): Promise<string | undefined> {
  const routed = await defaultRouteAddress()
  return routed === undefined || routed.startsWith('127.') ? scannedAddress() : routed
}

/**
 * Compose the fallback bind address from the saved policy.
 * @param config - the deployment's bind policy.
 * @param detect - address discovery for `auto`; tests substitute it.
 * @returns the mode in force and the address it resolves to. `auto` prefers
 *   the detected interface address and falls back to `bindHost`, which keeps
 *   the page's address field meaningful in that mode.
 * @throws when `fixed` names no address, so a saved edit cannot silently fall
 *   back to loopback while the page shows an address.
 */
export async function resolveBind(
  config: { bindMode: BindMode; bindHost: string },
  detect: () => Promise<string | undefined> = detectLanAddress,
): Promise<BindValues> {
  const mode = config.bindMode
  if (mode === 'loopback') return { mode, host: LOOPBACK_HOST }
  if (mode === 'fixed') {
    const host = config.bindHost.trim()
    if (host === '') {
      throw new Error('web-startup: bindMode "fixed" needs bindHost; set the address in Settings → Connect phone, or pass --host')
    }
    return { mode, host }
  }
  const detected = await detect()
  if (detected !== undefined) return { mode, host: detected }
  const saved = config.bindHost.trim()
  return { mode, host: saved === '' ? LOOPBACK_HOST : saved }
}

/**
 * This app's command: its flags, its description, and its help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function webCommand(): Command {
  return new Command()
    .name('dsh --profile web')
    .description('Serve the DeepSeek Harness browser UI.')
    .helpOption('-h, --help', 'show this help')
    .option('--host <host>', 'bind address: one concrete IPv4 or IPv6 literal of a local interface; wildcard addresses are rejected, and this overrides the address saved in Settings')
    .option('--no-open', 'do not open the Web UI in the default browser')
    .option('--port <port>', 'listen port; pass 0 to let the OS pick a free one')
    .option('--public-url <url>', 'advertise this HTTP(S) root in the printed, opened, runtime-context, and DSH_WEB_URL forms; grants no trust')
    .option('--trusted-host <authority...>', 'extra authority the /api browser-trust fence accepts (host or host:port; repeatable)')
    .option('--tls-cert <file>', 'PEM server certificate chain; requires --tls-key')
    .option('--tls-key <file>', 'unencrypted PEM private key; requires --tls-cert')
    .addHelpText('after', `
Examples:
  dsh --profile web                          serve on the composed host and port
  dsh --profile web --no-open                serve without opening a browser
  dsh --profile web --port 8080              serve on another port
  dsh --profile web --host 10.0.0.7          bind one local interface address
  dsh --profile web --public-url https://app.example/ui/ --trusted-host app.example
                                             advertise a prefix-stripping HTTPS proxy entry and admit its authority
  dsh --profile web --tls-cert ./server-chain.pem --tls-key ./server-key.pem
                                             serve HTTPS with an existing certificate and key
`)
}

/**
 * Parse and provide the Web invocation as an ordinary Cordis service. The
 * command's action records the flags this invocation named; the service is
 * published once the fallback bind address is known, so a dependent row's
 * config expression reads a settled value. Invalid flags, including an unpaired
 * TLS certificate or key, are usage errors; rejection and `--help` provide no
 * service.
 * @param ctx - plugin context carrying the command line.
 * @param config - validated fallback bind policy.
 * @returns settlement after the service is published, or nothing when the
 *   invocation asked for help or was rejected.
 */
export function apply(ctx: Context, config: Config): Promise<void> | undefined {
  const program = webCommand()
  let invocation: Omit<WebStartupValues, 'bind'> | undefined
  program.action(() => {
    const options = program.opts<WebOptions>()
    if (options.host !== undefined && isWildcardHost(options.host)) {
      program.error(`error: --host ${options.host} is an unspecified (wildcard) address, which is not supported: binding every interface would expose remote code execution to the network; bind one concrete IPv4 or IPv6 address instead`)
    }
    if (options.port !== undefined && !/^\d+$/.test(options.port)) {
      program.error(`error: --port must be a number, got ${JSON.stringify(options.port)}`)
    }
    let tls: TlsConfig | undefined
    if (options.tlsCert !== undefined && options.tlsKey !== undefined) {
      tls = { certFile: options.tlsCert, keyFile: options.tlsKey }
    } else if (options.tlsCert !== undefined || options.tlsKey !== undefined) {
      program.error('error: --tls-cert and --tls-key must be supplied together')
    }
    if (options.publicUrl !== undefined) {
      try {
        parsePublicUrl(options.publicUrl, '--public-url')
      } catch (error) {
        program.error(`error: ${(error as Error).message}`)
      }
    }
    invocation = {
      openBrowser: options.open,
      ...options.host !== undefined && { host: options.host },
      ...options.port !== undefined && { port: Number(options.port) },
      ...options.publicUrl !== undefined && { publicUrl: options.publicUrl },
      ...tls !== undefined && { tls },
      trustedHosts: options.trustedHost ?? [],
    }
  })
  parseCmdline(ctx, program)
  if (invocation === undefined) return undefined
  return publish(ctx, invocation, config)
}

/**
 * Publish the parsed invocation once the fallback bind address settles.
 * @param ctx - plugin context providing the service.
 * @param invocation - the flag values this invocation named.
 * @param config - validated fallback bind policy.
 * @returns settlement after publication.
 */
async function publish(
  ctx: Context,
  invocation: Omit<WebStartupValues, 'bind'>,
  config: Config,
): Promise<void> {
  const bind = await resolveBind({ bindMode: config.bindMode.get(), bindHost: config.bindHost.get() })
  ctx.provide(WEB_STARTUP_SERVICE, { ...invocation, bind } satisfies WebStartupValues)
}
