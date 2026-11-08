/** Connect-phone settings page registration: slot entry, dictionaries, injected face, disposal. */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { MobileSection, type MobileSectionInjected } from '../src/client/MobileSection.tsx'
import { AuthRequiredScreen, type AuthRequiredScreenInjected } from '../src/client/AuthRequiredScreen.tsx'
import { PairScreen, type PairScreenInjected } from '../src/client/PairScreen.tsx'
import type { MobileBindSettings } from '../src/client/bind-settings.ts'

/** The children the shell declares for this suite's registrations. */
const SHELL_CHILDREN = {
  'settings.section': { kind: 'list', scope: 'root' },
  'shell.overlay': { kind: 'list', scope: 'root' },
} as const

function declare(slots: SlotRegistry): void {
  slots.register({
    name: 'root',
    children: SHELL_CHILDREN,
  } as never, () => null)
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__DSH_PAIR__')
  Reflect.deleteProperty(globalThis, '__DSH_AUTH_REQUIRED__')
  vi.unstubAllGlobals()
})

/** One settings form stub: a settled `web-startup` section and its write queue. */
function bindForm(value: MobileBindSettings = { bindMode: 'loopback', bindHost: '' }) {
  return {
    getSnapshot: () => ({
      status: 'ready' as const,
      value,
      base: undefined,
      user: undefined,
      revision: 1,
      writable: true,
      mode: 'host' as const,
    }),
    subscribe: () => () => {},
    mutate: vi.fn(async () => true),
    set: vi.fn(async () => true),
    unset: vi.fn(async () => true),
  }
}

async function bench(value?: MobileBindSettings) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const connectionFailure = { getSnapshot: () => undefined, subscribe: () => () => {} }
  ctx.provide('connection', { isLoopback: true, failure: connectionFailure } as never)
  const form = bindForm(value)
  const get = vi.fn(() => form)
  ctx.provide('configForms', { get } as never)
  const joinUrl = vi.fn(async () => ({ ok: true as const, value: 'http://192.168.1.5:3080/' }))
  new TestRemote(ctx, { mob: { joinUrl } })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, joinUrl, connectionFailure, form, get }
}

describe('dsh-mob client apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'remote.mob', 'configForms'])
  })

  it('registers the Connect-phone page as a settings section', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(MobileSection)
    expect(entry.options).toMatchObject({ id: 'mobile', order: 12 })
    expect(typeof entry.options.label).toBe('function')
    expect((entry.options.label as () => string)()).toBe('连接手机')
  })

  it('registers into a declaration that arrives after apply, and leaves on disposal', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toHaveLength(0)

    declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })

    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
  })

  it('reads the join URL through the mob Remote namespace and binds the saved policy', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const injected = entry.inject as unknown as () => MobileSectionInjected
    await expect(injected().joinUrl()).resolves.toEqual({ ok: true, value: 'http://192.168.1.5:3080/' })
    expect(b.joinUrl).toHaveBeenCalledOnce()
    expect(b.get).toHaveBeenCalledWith('web-startup')
    expect(injected().hooks.bind).toBe(b.form)

    await expect(injected().saveBind({ bindMode: 'fixed', bindHost: '192.168.1.5' })).resolves.toBe(true)
    expect(b.form.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['bindMode'], value: 'fixed' },
      { op: 'set', path: ['bindHost'], value: '192.168.1.5' },
    ])
  })

  it('reports a refused save as a failed write rather than a crash', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = (b.slots.entries('settings.section')[0]!.inject as unknown as () => MobileSectionInjected)()
    b.form.mutate.mockRejectedValueOnce(new Error('transport closed'))
    await expect(injected.saveBind({ bindMode: 'auto', bindHost: '' })).resolves.toBe(false)
    b.form.mutate.mockResolvedValueOnce(false)
    await expect(injected.saveBind({ bindMode: 'auto', bindHost: '' })).resolves.toBe(false)
  })

  it('registers the pairing screen only when the page carries the pairing boot fact', async () => {
    const ordinary = await bench()
    declare(ordinary.slots)
    await ordinary.ctx.plugin({ inject: [...inject], apply }).await()
    // An ordinary page holds no pairing screen; the session-required screen is
    // the one standing overlay, and it renders nothing while the session works.
    expect(ordinary.slots.entries('shell.overlay').map(entry => entry.component)).toEqual([AuthRequiredScreen])

    Reflect.set(globalThis, '__DSH_PAIR__', { code: 'ABCD2345' })
    const pairing = await bench()
    declare(pairing.slots)
    const fiber = pairing.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const entry = pairing.slots.entries('shell.overlay')[0]!
    expect(entry.component).toBe(PairScreen)
    expect(entry.options).toMatchObject({ id: 'pair-screen', order: 100 })
    const injected = entry.inject as unknown as () => PairScreenInjected
    expect(injected().code).toBe('ABCD2345')
    expect(injected()).toBe(injected())

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'pending' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(injected().pollState()).resolves.toEqual({ status: 'pending' })
    expect(fetchMock).toHaveBeenCalledWith('/pair/state?c=ABCD2345', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
    expect(typeof injected().navigate).toBe('function')
    const replace = vi.fn()
    vi.stubGlobal('location', { replace })
    injected().navigate('/')
    expect(replace).toHaveBeenCalledWith('/')

    await fiber.dispose()
    expect(pairing.slots.entries('shell.overlay')).toHaveLength(0)
  })

  it('registers the session-required screen on every page and reports whether this document was refused', async () => {
    const ordinary = await bench()
    declare(ordinary.slots)
    await ordinary.ctx.plugin({ inject: [...inject], apply }).await()
    const standing = ordinary.slots.entries('shell.overlay')[0]!
    expect(standing.component).toBe(AuthRequiredScreen)
    expect((standing.inject as unknown as () => AuthRequiredScreenInjected)().refused).toBe(false)

    Reflect.set(globalThis, '__DSH_AUTH_REQUIRED__', true)
    const refused = await bench()
    declare(refused.slots)
    const fiber = refused.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const entry = refused.slots.entries('shell.overlay')[0]!
    expect(entry.component).toBe(AuthRequiredScreen)
    expect(entry.options).toMatchObject({ id: 'auth-required-screen', order: 90 })
    const injected = entry.inject as unknown as () => AuthRequiredScreenInjected
    expect(injected().refused).toBe(true)
    // The live failure rides the connection's own source, so a credential that
    // lapses after this page loaded states its reason on the same screen.
    expect(injected().hooks.connectionFailure).toBe(refused.connectionFailure)
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    injected().reload()
    expect(reload).toHaveBeenCalledOnce()

    await fiber.dispose()
    expect(refused.slots.entries('shell.overlay')).toHaveLength(0)
  })

  it('prefers the pairing screen when a page somehow carries both facts', async () => {
    Reflect.set(globalThis, '__DSH_PAIR__', { code: 'ABCD2345' })
    Reflect.set(globalThis, '__DSH_AUTH_REQUIRED__', true)
    const both = await bench()
    declare(both.slots)
    await both.ctx.plugin({ inject: [...inject], apply }).await()

    const entries = both.slots.entries('shell.overlay')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.component).toBe(PairScreen)
  })
})
