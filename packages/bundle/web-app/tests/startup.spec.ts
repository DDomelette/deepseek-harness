/**
 * The Web command-line provider over a real Loader tree: its ordinary service
 * releases a consumer whose config reads `ctx.webStartup` directly, and the
 * fallback bind policy decides the address a launch without `--host` uses.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply, Config, detectLanAddress, resolveBind, WEB_STARTUP_SERVICE,
  type BindMode, type WebStartupValues,
} from '../src/startup.ts'

vi.mock('node:dgram', () => ({ createSocket: vi.fn() }))
vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  networkInterfaces: vi.fn(),
}))

const dgram = await import('node:dgram')
const os = await import('node:os')

/** What one fixture boot observed. */
interface Observed {
  exits: number[]
  out: string
  readerConfig?: unknown
}

/** Fallback bind policy one fixture boot composes. */
interface BindConfig {
  bindMode: BindMode
  bindHost: string
}

const disposers: (() => Promise<void>)[] = []

/** Fixture tree roots, removed after their booted tree has been disposed. */
const tempDirs: string[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  internals.stdout = process.stdout
  internals.stderr = process.stderr
  vi.clearAllMocks()
})

/**
 * Mount the real provider and a consumer using injection-ordered config.
 * @param args - the invocation's inner arguments.
 * @param bind - fallback bind policy the fixture entry composes.
 * @returns the service value and observed consumer/process effects.
 */
async function bootProvider(
  args: string[],
  bind: BindConfig = { bindMode: 'loopback', bindHost: '' },
): Promise<{
  values: WebStartupValues | undefined
  observed: Observed
}> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-web-startup-'))
  tempDirs.push(dir)
  const observed: Observed = { exits: [], out: '' }
  writeFileSync(join(dir, 'reader.mjs'), `
export function apply(_ctx, config) { globalThis.__webStartupObserved.readerConfig = config }
`)
  // Node imports the fixture row outside Vite's source resolver, so delegate
  // to the source-plane plugin already imported by this test.
  writeFileSync(join(dir, 'provider.mjs'), `
export const name = 'web-startup'
export const inject = ['cmdlineArgs']
export const Config = globalThis.__webStartupConfig
export const apply = (ctx, config) => globalThis.__webStartupApply(ctx, config)
`)
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: reader',
    `  name: ${pathToFileURL(join(dir, 'reader.mjs')).href}`,
    `  inject: [${WEB_STARTUP_SERVICE}]`,
    '  config:',
    '    host: !!js ctx.webStartup.host ?? ctx.webStartup.bind.host',
    '    openBrowser: !!js ctx.webStartup.openBrowser',
    '    port: !!js ctx.webStartup.port ?? 3080',
    '    publicUrl: !!js ctx.webStartup.publicUrl',
    '    trustedHosts: !!js ctx.webStartup.trustedHosts',
    '    tls: !!js ctx.webStartup.tls',
    '- id: provider',
    `  name: ${pathToFileURL(join(dir, 'provider.mjs')).href}`,
    '  config:',
    `    bindMode: ${bind.bindMode}`,
    `    bindHost: ${JSON.stringify(bind.bindHost)}`,
    '',
  ].join('\n'))
  const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
  internals.stdout = observing
  internals.stderr = observing
  const globals = globalThis as unknown as {
    __webStartupApply: typeof apply
    __webStartupConfig: typeof Config
    __webStartupObserved: Observed
  }
  globals.__webStartupApply = apply
  globals.__webStartupConfig = Config
  globals.__webStartupObserved = observed

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return {
    values: ctx.get(WEB_STARTUP_SERVICE) as WebStartupValues | undefined,
    observed,
  }
}

describe('web command-line provider', () => {
  it('publishes each flag and releases direct service expressions', async () => {
    const { values, observed } = await bootProvider([
      '--host', '127.0.0.1',
      '--no-open',
      '--port', '8080',
      '--trusted-host', 'lab.internal', 'lab-2.internal',
      '--trusted-host', '10.0.0.9',
      '--tls-cert', 'fullchain.pem',
      '--tls-key', 'private-key.pem',
    ])
    expect(values).toEqual({
      host: '127.0.0.1',
      openBrowser: false,
      port: 8080,
      trustedHosts: ['lab.internal', 'lab-2.internal', '10.0.0.9'],
      tls: { certFile: 'fullchain.pem', keyFile: 'private-key.pem' },
      bind: { mode: 'loopback', host: '127.0.0.1' },
    })
    // The consumer names the fields it reads; `bind` is published for the rows
    // whose config falls back to it, not copied into this reader.
    const { bind: _bind, ...published } = values as WebStartupValues
    expect(observed.readerConfig).toMatchObject(published)
    expect(observed.exits).toEqual([])
  })

  // The webserver suite owns the wildcard spellings; the CLI only has to
  // refuse them by address value before any consumer activates.
  it.each(['0.0.0.0', '::ffff:0.0.0.0'])('rejects wildcard --host %s before activating consumers', async (host) => {
    const { values, observed } = await bootProvider(['--host', host])
    expect(observed.out).toContain(`error: --host ${host} is an unspecified (wildcard) address`)
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('leaves deployment values to each consumer when flags omit them', async () => {
    const { values, observed } = await bootProvider([])
    expect(values).toEqual({
      openBrowser: true,
      trustedHosts: [],
      bind: { mode: 'loopback', host: '127.0.0.1' },
    })
    expect(observed.readerConfig).toEqual({
      host: '127.0.0.1',
      openBrowser: true,
      port: 3080,
      trustedHosts: [],
    })
  })

  it('binds the address saved in the bind policy when the invocation names none', async () => {
    const { values, observed } = await bootProvider([], { bindMode: 'fixed', bindHost: '192.168.1.5' })
    expect(values?.bind).toEqual({ mode: 'fixed', host: '192.168.1.5' })
    expect(observed.readerConfig).toMatchObject({ host: '192.168.1.5' })
  })

  it('prints its own help and leaves the consumer pending', async () => {
    const { values, observed } = await bootProvider(['--help'])
    expect(observed.out).toContain('dsh --profile web')
    expect(observed.out).toContain('--no-open')
    expect(observed.out).toContain('--public-url')
    expect(observed.out).toContain('--trusted-host')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([0])
  })

  it('rejects a non-numeric port before the consumer activates', async () => {
    const { values, observed } = await bootProvider(['--port', 'abc'])
    expect(observed.out).toContain('--port must be a number')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('publishes --public-url as advertisement only, leaving the fence to --trusted-host', async () => {
    const { values, observed } = await bootProvider([
      '--public-url', 'https://web.example/ui',
      '--trusted-host', 'lab.internal',
    ])
    expect(values).toEqual({
      openBrowser: true,
      publicUrl: 'https://web.example/ui',
      trustedHosts: ['lab.internal'],
      bind: { mode: 'loopback', host: '127.0.0.1' },
    })
    expect(observed.readerConfig).toEqual({
      host: '127.0.0.1',
      openBrowser: true,
      port: 3080,
      publicUrl: 'https://web.example/ui',
      trustedHosts: ['lab.internal'],
    })
    expect(observed.exits).toEqual([])
  })

  it.each(['--tls-cert', '--tls-key'])('rejects an unpaired %s before activating consumers', async (flag) => {
    const { values, observed } = await bootProvider([flag, 'server.pem'])
    expect(observed.out).toContain('--tls-cert and --tls-key must be supplied together')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('rejects a malformed --public-url before the consumer activates', async () => {
    // The parser's own suite owns the exhaustive spellings; the provider only
    // has to fail the invocation before any consumer activates.
    const { values, observed } = await bootProvider(['--public-url', '/web/ui'])
    expect(observed.out).toContain('error: --public-url must be an absolute http or https URL of the form http(s)://host[/prefix]')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })
})

describe('fallback bind policy', () => {
  it('returns the loopback address without asking the network', async () => {
    await expect(resolveBind({ bindMode: 'loopback', bindHost: '10.0.0.7' })).resolves.toEqual({
      mode: 'loopback',
      host: '127.0.0.1',
    })
  })

  it('trims the fixed address and binds it verbatim', async () => {
    await expect(resolveBind({ bindMode: 'fixed', bindHost: ' 192.168.1.5 ' })).resolves.toEqual({
      mode: 'fixed',
      host: '192.168.1.5',
    })
  })

  it('refuses a fixed policy that names no address', async () => {
    await expect(resolveBind({ bindMode: 'fixed', bindHost: '   ' })).rejects.toThrow(
      'web-startup: bindMode "fixed" needs bindHost',
    )
  })

  it('uses the detected interface address, falling back to loopback without one', async () => {
    const detector = vi.fn(async () => '192.168.1.9')
    await expect(resolveBind({ bindMode: 'auto', bindHost: '' }, detector)).resolves.toEqual({
      mode: 'auto',
      host: '192.168.1.9',
    })
    await expect(resolveBind({ bindMode: 'auto', bindHost: '' }, async () => undefined)).resolves.toEqual({
      mode: 'auto',
      host: '127.0.0.1',
    })
  })
})

/** One scripted UDP socket for the route probe. */
function scriptedSocket(behavior: { address?: string | Error; fail?: boolean }) {
  const listeners = new Map<string, () => void>()
  const socket = {
    once: (event: string, listener: () => void) => {
      listeners.set(event, listener)
      return socket
    },
    connect: (_port: number, _host: string, connected: () => void) => {
      if (behavior.fail === true) listeners.get('error')?.()
      else connected()
    },
    address: () => {
      if (behavior.address instanceof Error || behavior.address === undefined) {
        throw behavior.address ?? new Error('unbound')
      }
      return { address: behavior.address }
    },
    close: vi.fn(),
  }
  return socket
}

describe('interface detection', () => {
  it('takes the address the default route would use', async () => {
    vi.mocked(dgram.createSocket).mockReturnValue(scriptedSocket({ address: '192.168.1.5' }) as never)
    await expect(detectLanAddress()).resolves.toBe('192.168.1.5')
  })

  it('falls back to the first usable interface when the route probe fails', async () => {
    vi.mocked(dgram.createSocket).mockReturnValue(scriptedSocket({ fail: true }) as never)
    vi.mocked(os.networkInterfaces).mockReturnValue({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      link: [{ address: '169.254.10.2', family: 'IPv4', internal: false }],
      v6: [{ address: 'fe80::1', family: 'IPv6', internal: false }],
      wlan: [{ address: '192.168.1.7', family: 'IPv4', internal: false }],
    } as never)
    await expect(detectLanAddress()).resolves.toBe('192.168.1.7')
  })

  it('treats an unbound probe socket and a loopback route as no route', async () => {
    vi.mocked(dgram.createSocket).mockReturnValue(scriptedSocket({ address: new Error('EBADF') }))
    vi.mocked(os.networkInterfaces).mockReturnValue({})
    await expect(detectLanAddress()).resolves.toBeUndefined()

    vi.mocked(dgram.createSocket).mockReturnValue(scriptedSocket({ address: '127.0.0.1' }))
    await expect(detectLanAddress()).resolves.toBeUndefined()
  })

  it('ignores empty interface entries', async () => {
    vi.mocked(dgram.createSocket).mockReturnValue(scriptedSocket({ fail: true }) as never)
    vi.mocked(os.networkInterfaces).mockReturnValue({ ghost: undefined })
    await expect(detectLanAddress()).resolves.toBeUndefined()
  })
})
