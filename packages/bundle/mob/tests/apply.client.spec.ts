/** Connect-phone row registration: slot entry, locale dictionaries, injected joinUrl read, disposal. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { ConnectPhoneRow } from '../src/client/ConnectPhoneRow.tsx'
import type { ConnectPhoneRowInjected } from '../src/client/ConnectPhoneRow.tsx'

function declare(slots: SlotRegistry): void {
  slots.register({
    name: 'root',
    children: { 'settings.general.item': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const joinUrl = vi.fn(async () => ({ ok: true as const, value: 'http://192.168.1.5:3080/?token=t' }))
  new TestRemote(ctx, { mob: { joinUrl } })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, joinUrl }
}

describe('dsh-mob client apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.mob'])
  })

  it('registers the Connect-phone row into the General item slot', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.general.item')[0]!
    expect(entry.component).toBe(ConnectPhoneRow)
    expect(entry.options).toMatchObject({ id: 'connect-phone', order: 30 })
  })

  it('registers into a declaration that arrives after apply, and leaves on disposal', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.general.item')).toHaveLength(0)

    declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.general.item')).toHaveLength(1) })

    await fiber.dispose()
    expect(b.slots.entries('settings.general.item')).toHaveLength(0)
  })

  it('reads the join URL through the mob Remote namespace', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.general.item')[0]!
    const injected = entry.inject as unknown as () => ConnectPhoneRowInjected
    await expect(injected().joinUrl()).resolves.toEqual({ ok: true, value: 'http://192.168.1.5:3080/?token=t' })
    expect(b.joinUrl).toHaveBeenCalledOnce()
  })
})
