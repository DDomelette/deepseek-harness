/**
 * The QR announcer: prints the authenticated LAN URL as a terminal QR code
 * once the tree settles; loopback-only and non-TTY deployments print nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  networkInterfaces: () => ({
    lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    en0: [{ family: 'IPv4', internal: false, address: '192.168.1.5' }],
  }),
}))

vi.mock('qrcode-terminal', () => ({
  default: { generate: vi.fn() },
}))

import qrcode from 'qrcode-terminal'
import { apply } from '../src/index.ts'

const generate = vi.mocked(qrcode.generate)
const LAN_URL = 'http://192.168.1.5:4567/?token=test-token'
const originalIsTTY = process.stdout.isTTY

function setTTY(value: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true })
}

function provideConnection(ctx: Context): void {
  ctx.provide('connection', {
    authenticatedUrl(baseUrl: string) {
      const url = new URL(baseUrl)
      url.searchParams.set('token', 'test-token')
      return url.href
    },
  } as never)
}

function fakeWebServer(host: '127.0.0.1' | '0.0.0.0'): never {
  return { host, port: 4567 } as never
}

beforeEach(() => {
  setTTY(true)
})

afterEach(() => {
  setTTY(originalIsTTY)
  vi.restoreAllMocks()
  generate.mockReset()
})

describe('mob QR announcer', () => {
  it('prints the LAN join line and QR once the tree is ready', async () => {
    const ctx = new Context()
    ctx.provide('webServer', fakeWebServer('0.0.0.0'))
    provideConnection(ctx)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).toHaveBeenCalledWith(`dsh mob: scan to join from this network: ${LAN_URL}`)
    expect(generate).toHaveBeenCalledWith(LAN_URL, { small: true })
    await ctx.fiber.dispose()
  })

  it('prints nothing on a loopback-only deployment', async () => {
    const ctx = new Context()
    ctx.provide('webServer', fakeWebServer('127.0.0.1'))
    provideConnection(ctx)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('prints nothing when stdout is not a TTY', async () => {
    setTTY(false)
    const ctx = new Context()
    ctx.provide('webServer', fakeWebServer('0.0.0.0'))
    provideConnection(ctx)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('does not print again when Connection reloads', async () => {
    const ctx = new Context()
    ctx.provide('webServer', fakeWebServer('0.0.0.0'))
    const first = ctx.plugin((connectionCtx: Context) => { provideConnection(connectionCtx) })
    await first
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).toHaveBeenCalledTimes(1)

    await first.dispose()
    await ctx.plugin((connectionCtx: Context) => { provideConnection(connectionCtx) })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('defers to Loader settlement and drops the announcement on failure or teardown', async () => {
    // Settlement path.
    const settled = new Context()
    settled.provide('webServer', fakeWebServer('0.0.0.0'))
    provideConnection(settled)
    let release: () => void
    const settlement = new Promise<void>((resolve) => { release = resolve })
    settled.provide('loader', { await: () => settlement } as never)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(settled)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    release!()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).toHaveBeenCalledWith(`dsh mob: scan to join from this network: ${LAN_URL}`)
    await settled.fiber.dispose()

    // Failed path.
    log.mockClear()
    generate.mockClear()
    const failed = new Context()
    failed.provide('webServer', fakeWebServer('0.0.0.0'))
    provideConnection(failed)
    failed.provide('loader', { await: async () => { throw new Error('boot failed') } } as never)
    apply(failed)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    await failed.fiber.dispose()

    // Torn-down path.
    log.mockClear()
    const torn = new Context()
    const child = torn.plugin((childCtx: Context) => {
      childCtx.provide('webServer', fakeWebServer('0.0.0.0'))
      provideConnection(childCtx)
    })
    await child
    let releaseTorn: () => void
    const tornSettlement = new Promise<void>((resolve) => { releaseTorn = resolve })
    torn.provide('loader', { await: () => tornSettlement } as never)
    apply(torn)
    await new Promise(resolve => setTimeout(resolve, 0))
    await child.dispose()
    releaseTorn!()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    await torn.fiber.dispose()
  })
})
