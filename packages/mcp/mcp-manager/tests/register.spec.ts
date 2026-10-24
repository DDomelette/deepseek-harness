import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-settings'
import McpManager from '../src/index.ts'
import { declarativeMcpServers, MCP_CLIENT_MODULE } from '../src/declarative.ts'
import { McpServersSchema } from '../src/schema.ts'
import type { McpStdioEntry } from '../src/schema.ts'
import { fakeLoader, type FakeLoaderEntry } from './fixtures.ts'

/** FiberState.ACTIVE mirrored numerically: FiberState is a cross-package const enum. */
const FIBER_STATE_ACTIVE = 2

/** Resolved stdio entry for a server the tests never mount. */
function entry(over: Partial<McpStdioEntry> = {}): McpStdioEntry {
  return {
    enabled: false,
    transport: 'stdio',
    command: 'memorix',
    args: [],
    env: {},
    cwd: '',
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
    ...over,
  }
}

// Dispose every booted context so a mounted roster never outlives its test.
const booted: Context[] = []

afterEach(async () => {
  await Promise.all(booted.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function boot(loaderEntries: FakeLoaderEntry[] = []) {
  const ctx = new Context()
  ctx.provide('loader', fakeLoader(loaderEntries) as never)
  const manager = await ctx.plugin(McpManager)
  booted.push(ctx)
  return { ctx, manager }
}

describe('mcp-manager section config', () => {
  it('declares the mcp-servers section as the plugin Config and applies a commit to the running plugin', async () => {
    const { ctx, manager } = await boot()
    expect(McpManager.Config).toBe(McpServersSchema)
    // The volatile `servers` field is what makes the roster a settings form
    // whose commits land in the running instance instead of a remount.
    expect(McpServersSchema.dict?.servers?.meta.volatile).toBe(true)
    await manager.update({ servers: { alpha: entry() } })
    const gateway = ctx.get('mcpServers') as McpManager
    expect(gateway.list().entries).toEqual([
      { serverName: 'alpha', transport: 'stdio', source: 'settings', enabled: false, status: null },
    ])
  })

  it('accepts a well-formed section and resolves schema defaults', async () => {
    const value = McpServersSchema({ servers: { alpha: { transport: 'stdio', command: 'memorix' } } } as never).servers.get()
    expect(value).toMatchObject({
      alpha: {
        enabled: true,
        command: 'memorix',
        toolCallTimeoutMs: 60_000,
        reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
      },
    })
  })

  it('preserves and resolves a partial reconnect policy for the mounted client', async () => {
    const value = McpServersSchema({
      servers: { alpha: { transport: 'stdio', command: 'memorix', reconnect: { enabled: false, initialDelayMs: 750 } } },
    } as never).servers.get()
    expect(value).toMatchObject({
      alpha: {
        reconnect: { enabled: false, initialDelayMs: 750, maxDelayMs: 30_000, maxAttempts: 10 },
      },
    })
  })

  it('refuses a live edit whose serverName collides with a declarative entry', async () => {
    const { manager } = await boot([{
      name: MCP_CLIENT_MODULE,
      config: { serverName: 'memorix', transport: 'stdio' },
    }])
    expect(() => manager.update({ servers: { memorix: entry() } })).toThrow(/memorix/)
  })

  it('refuses a live edit whose key violates the serverName pattern', async () => {
    const { manager } = await boot()
    expect(() => manager.update({ servers: { 'has space': entry() } })).toThrow()
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
