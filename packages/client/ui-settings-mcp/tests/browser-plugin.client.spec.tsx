// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import { McpSettingsTab } from '../src/client/McpSettingsTab.tsx'
import type { McpSettingsTabInjected } from '../src/client/McpSettingsTab.tsx'
import { MCP_SERVERS_NS } from '../src/client/mcp-tab-controller.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const EMPTY = { entries: [] }
type ListResult =
  | { readonly ok: true; readonly value: typeof EMPTY }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  const list = vi.fn<() => Promise<ListResult>>()
    .mockResolvedValue({ ok: true, value: EMPTY })
  ctx.provide('remote.mcpServers', { list })
  const set = vi.fn<(field: string, value: unknown) => Promise<void>>().mockResolvedValue()
  const setPath = vi.fn<(path: readonly string[], value: unknown) => Promise<void>>().mockResolvedValue()
  const scope = {
    getSnapshot: () => ({
      status: 'ready' as const,
      value: { filesystem: { enabled: true, transport: 'stdio' as const } },
      base: undefined,
      user: undefined,
      revision: 1,
      writable: true,
      mode: 'host' as const,
    }),
    subscribe: () => () => {},
    set,
    setPath,
    unset: vi.fn<() => Promise<void>>().mockResolvedValue(),
  }
  const bind = vi.fn(() => scope)
  ctx.provide('settingsScope', { bind } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, list, bind, set, setPath }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-mcp browser plugin', () => {
  it('declares only the services used by the roster contribution', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.mcpServers', 'settingsScope'])
  })

  it('registers a localized tab without reading the Remote eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.plugins.tab')[0]!
    expect(entry.component).toBe(McpSettingsTab)
    expect(entry.options).toMatchObject({ id: 'mcp', order: 5 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('MCP')
    expect(b.bind).toHaveBeenCalledWith({ namespace: MCP_SERVERS_NS })
    expect(b.list).not.toHaveBeenCalled()

    const injected = (entry.inject as unknown as () => McpSettingsTabInjected)()
    await expect(injected.list()).resolves.toEqual(EMPTY)
    expect(b.list).toHaveBeenCalledOnce()
    b.list.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } })
    await expect(injected.list()).rejects.toThrow('mcpServers.list failed: REMOTE_ERROR: unavailable')

    await injected.setEnabled('filesystem', false)
    expect(b.set).not.toHaveBeenCalled()
    expect(b.setPath).toHaveBeenCalledWith(['filesystem', 'enabled'], false)
    await b.ctx.fiber.dispose()
  })

  it('follows locale and recovers across late declaration and declarer reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(1) })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.plugins.tab')[0]!.options.label)).toBe('MCP')

    stop()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')[0]?.component).toBe(McpSettingsTab)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(() => b.locale.register(NS, 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})
