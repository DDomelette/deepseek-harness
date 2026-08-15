/**
 * Gateway tests: the mcpServers Remote projects the union of the
 * settings-managed roster (read from the supervisor the gateway mounts) and
 * the declarative Loader entries, without leaking secret config fields.
 */

import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import McpServersGateway from '../src/index.ts'
import { McpServerSupervisor, trackSupervisor } from '../src/supervisor.ts'
import { MCP_SERVERS_NS } from '../src/schema.ts'
import type { McpStdioEntry } from '../src/schema.ts'
import { MemorySettings, fakeLoader } from './fixtures.ts'
import type { FakeLoaderEntry } from './fixtures.ts'

const fixtureServerPath = fileURLToPath(new URL('../../mcp-client/tests/fixture-server.ts', import.meta.url))

const MOUNT_TIMEOUT = 15_000

/** Declarative Loader entries every gateway test sees. */
const DECLARATIVE: FakeLoaderEntry[] = [
  {
    name: '@deepseek-ai/dsh-mcp-client',
    config: { serverName: 'docs', transport: 'streamable-http', url: 'https://example.com/mcp', headers: { authorization: 'Bearer x' } },
    fiberState: 2, // FiberState.ACTIVE
  },
  {
    name: '@deepseek-ai/dsh-mcp-client',
    config: { serverName: 'legacy', transport: 'stdio', command: 'cmd', env: { TOKEN: 'y' } },
    disabled: true,
  },
  // Skipped: no readable serverName in config.
  { name: '@deepseek-ai/dsh-mcp-client', config: { transport: 'stdio', command: 'cmd' } },
  // Skipped: not an mcp-client entry.
  { name: '@deepseek-ai/dsh-tools' },
  // Skipped: group entries own no server.
  { name: '@deepseek-ai/dsh-mcp-client', group: true, config: { serverName: 'grouped', transport: 'stdio', command: 'cmd' } },
]

async function boot(doc?: Record<string, unknown>): Promise<{ ctx: Context; gateway: McpServersGateway }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.provide('loader', fakeLoader(DECLARATIVE) as never)
  await ctx.plugin(MemorySettings, doc === undefined ? {} : { doc })
  await ctx.plugin(McpServersGateway)
  const gateway = ctx.get('mcpServers') as McpServersGateway
  return { ctx, gateway }
}

/** Resolved stdio entry spawning the shared fixture server. */
function fixtureEntry(over: Partial<McpStdioEntry> = {}): McpStdioEntry {
  return {
    enabled: true,
    transport: 'stdio',
    command: process.execPath,
    args: [fixtureServerPath],
    env: {},
    cwd: '',
    toolCallTimeoutMs: 15_000,
    failOnStartupError: false,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
    ...over,
  }
}

/** Spawn the fixture server through a settings commit. */
async function writeEntry(ctx: Context, serverName: string, entry: Partial<McpStdioEntry>): Promise<void> {
  await ctx.settings.update(settingsNamespace(MCP_SERVERS_NS), {
    [serverName]: { transport: 'stdio', command: process.execPath, args: [fixtureServerPath], ...entry },
  })
}

describe('McpServersGateway', () => {
  it('publishes one direct list method under the mcpServers namespace', async () => {
    const { ctx, gateway } = await boot()
    try {
      expect(gateway.typertRemote).toMatchObject({
        serviceKey: 'mcpServers',
        namespace: 'mcpServers',
      })
      expect(remoteMethods(gateway)).toEqual([
        { method: 'list', invocation: { kind: 'direct' } },
      ])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('projects the union of settings and declarative rows without secret fields', async () => {
    const { ctx, gateway } = await boot({
      [MCP_SERVERS_NS]: {
        off: { transport: 'stdio', command: 'cmd', enabled: false, env: { SECRET: 'z' } },
      },
    })
    try {
      const { entries } = gateway.list()
      expect(entries).toEqual([
        {
          serverName: 'off',
          transport: 'stdio',
          source: 'settings',
          enabled: false,
          status: null,
        },
        {
          serverName: 'docs',
          transport: 'streamable-http',
          source: 'declarative',
          enabled: true,
          status: null,
        },
        {
          serverName: 'legacy',
          transport: 'stdio',
          source: 'declarative',
          enabled: false,
          status: null,
        },
      ])
      // env/headers are role('secret') config: no row may carry them.
      for (const entry of entries) {
        expect(Object.keys(entry).sort()).toEqual(['enabled', 'serverName', 'source', 'status', 'transport'])
      }
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('reports a mounted entry through connecting to ready', async () => {
    const { ctx, gateway } = await boot()
    try {
      await writeEntry(ctx, 'echo', {})
      await vi.waitFor(() => {
        expect(gateway.list().entries).toContainEqual({
          serverName: 'echo',
          transport: 'stdio',
          source: 'settings',
          enabled: true,
          status: 'ready',
        })
      }, { timeout: MOUNT_TIMEOUT })
    } finally {
      await ctx.fiber.dispose()
    }
  }, 30_000)

  it('reports a fatal startup failure as failed with its message', async () => {
    const { ctx, gateway } = await boot()
    try {
      await writeEntry(ctx, 'broken', { command: 'dsh-not-a-real-command', failOnStartupError: true })
      await vi.waitFor(() => {
        const row = gateway.list().entries.find(entry => entry.serverName === 'broken')
        expect(row).toMatchObject({
          transport: 'stdio',
          source: 'settings',
          enabled: true,
          status: 'failed',
        })
        expect(row?.error).toBeTruthy()
      }, { timeout: MOUNT_TIMEOUT })
    } finally {
      await ctx.fiber.dispose()
    }
  }, 30_000)

  it('reads an enabled entry as connecting while its mount is still queued', async () => {
    const { ctx, gateway } = await boot()
    // A hand-driven supervisor replaces the gateway's own in the registry, so
    // the sync→mount queue window is observable synchronously.
    const supervisor = new McpServerSupervisor(ctx)
    const untrack = trackSupervisor(ctx, supervisor)
    try {
      supervisor.sync({ echo: fixtureEntry() })
      expect(gateway.list().entries).toContainEqual({
        serverName: 'echo',
        transport: 'stdio',
        source: 'settings',
        enabled: true,
        status: 'connecting',
      })
    } finally {
      await supervisor.dispose()
      untrack()
    }
    // With no supervisor registered, settings rows are simply absent while
    // declarative rows still project.
    expect(gateway.list().entries.map(entry => entry.serverName)).toEqual(['docs', 'legacy'])
    untrack() // a stale unpublish leaves a newer registration untouched
    await ctx.fiber.dispose()
  }, 30_000)
})
