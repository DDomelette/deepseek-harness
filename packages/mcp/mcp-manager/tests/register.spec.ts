import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import * as McpManager from '../src/index.ts'
import { declarativeMcpServers, MCP_CLIENT_MODULE } from '../src/declarative.ts'
import { MCP_SERVERS_NS } from '../src/schema.ts'
import { MemorySettings, fakeLoader, type FakeLoaderEntry } from './fixtures.ts'

/** FiberState.ACTIVE mirrored numerically: FiberState is a cross-package const enum. */
const FIBER_STATE_ACTIVE = 2

// Accepted writes hot-mount real mcp-client fibers; dispose every booted
// context so reconnect loops never outlive their test.
const booted: Context[] = []

afterEach(async () => {
  await Promise.all(booted.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function boot(loaderEntries: FakeLoaderEntry[] = []) {
  const ctx = new Context()
  ctx.provide('loader', fakeLoader(loaderEntries) as never)
  await ctx.plugin(MemorySettings)
  await ctx.plugin(McpManager)
  booted.push(ctx)
  return ctx
}

describe('mcp-manager settings registration', () => {
  it('registers the mcp-servers namespace with live apply', async () => {
    const ctx = await boot()
    const described = ctx.settings.describe({})
    const view = described.find(entry => entry.ns === settingsNamespace(MCP_SERVERS_NS))
    expect(view?.applies).toBe('live')
  })

  it('accepts a well-formed write and resolves schema defaults', async () => {
    const ctx = await boot()
    await ctx.settings.update(settingsNamespace(MCP_SERVERS_NS), {
      alpha: { transport: 'stdio', command: 'memorix' },
    })
    expect(ctx.settings.get(settingsNamespace(MCP_SERVERS_NS))).toMatchObject({
      alpha: { enabled: true, command: 'memorix', toolCallTimeoutMs: 60_000 },
    })
  })

  it('refuses a write whose serverName collides with a declarative entry', async () => {
    const ctx = await boot([{
      name: MCP_CLIENT_MODULE,
      config: { serverName: 'memorix', transport: 'stdio' },
    }])
    await expect(ctx.settings.update(settingsNamespace(MCP_SERVERS_NS), {
      memorix: { transport: 'stdio', command: 'x' },
    })).rejects.toThrow(/memorix/)
  })

  it('refuses a write whose key violates the serverName pattern', async () => {
    const ctx = await boot()
    await expect(ctx.settings.update(settingsNamespace(MCP_SERVERS_NS), {
      'has space': { transport: 'stdio', command: 'x' },
    })).rejects.toThrow(/has space/)
  })
})

describe('declarativeMcpServers', () => {
  it('projects only well-formed mcp-client entries, in Loader order', () => {
    const ctx = new Context()
    ctx.provide('loader', fakeLoader([
      // Group entries are containers, never servers.
      { name: MCP_CLIENT_MODULE, group: true, config: { serverName: 'grp', transport: 'stdio' } },
      { name: '@deepseek-ai/dsh-other', config: { serverName: 'other', transport: 'stdio' } },
      // Missing config: nothing readable to project.
      { name: MCP_CLIENT_MODULE },
      // Config without a readable serverName fails at its own fiber load, not here.
      { name: MCP_CLIENT_MODULE, config: { transport: 'stdio' } },
      { name: MCP_CLIENT_MODULE, config: { serverName: 'bogus', transport: 'unix-socket' } },
      { name: MCP_CLIENT_MODULE, config: { serverName: 'memorix', transport: 'stdio' } },
      { name: MCP_CLIENT_MODULE, config: { serverName: 'docs', transport: 'streamable-http' }, disabled: true, fiberState: FIBER_STATE_ACTIVE },
    ]) as never)
    expect(declarativeMcpServers(ctx)).toEqual([
      { serverName: 'memorix', transport: 'stdio', enabled: true, fiberPhase: null },
      { serverName: 'docs', transport: 'streamable-http', enabled: false, fiberPhase: 'active' },
    ])
  })
})
