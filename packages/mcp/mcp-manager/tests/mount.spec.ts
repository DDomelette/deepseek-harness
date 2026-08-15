/**
 * Mount integration tests: the supervisor drives real dsh-mcp-client fibers
 * against the shared stdio fixture server (spawn args mirror
 * mcp-client/tests/mcp-client.e2e.ts), and the plugin wiring turns settings
 * commits into mounts and disposals.
 */

import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import McpManager from '../src/index.ts'
import { McpServerSupervisor } from '../src/supervisor.ts'
import type { ManagedServerState } from '../src/supervisor.ts'
import { MCP_SERVERS_NS } from '../src/schema.ts'
import type { McpStdioEntry } from '../src/schema.ts'
import { MemorySettings, fakeLoader } from './fixtures.ts'

const fixtureServerPath = fileURLToPath(new URL('../../mcp-client/tests/fixture-server.ts', import.meta.url))

const MOUNT_TIMEOUT = 15_000

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

/** Expected state row for a mounted entry at the given status. */
function stateRow(serverName: string, status: ManagedServerState['status']): ManagedServerState {
  return { serverName, transport: 'stdio', enabled: true, status }
}

async function mountRegistry(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

async function boot(): Promise<{ ctx: Context; manager: Fiber }> {
  const ctx = await mountRegistry()
  ctx.provide('loader', fakeLoader([]) as never)
  await ctx.plugin(MemorySettings)
  const manager = await ctx.plugin(McpManager)
  return { ctx, manager }
}

/** Spawn the fixture server through a settings commit. */
async function writeEntry(ctx: Context, serverName: string, entry: Partial<McpStdioEntry>): Promise<void> {
  await ctx.settings.update(settingsNamespace(MCP_SERVERS_NS), {
    [serverName]: { transport: 'stdio', command: process.execPath, args: [fixtureServerPath], ...entry },
  })
}

describe('McpServerSupervisor mounting', () => {
  it('invalidates roster readers when mount lifecycle settles', async () => {
    const ctx = await mountRegistry()
    const supervisor = new McpServerSupervisor(ctx)
    const observed: ManagedServerState['status'][] = []
    ctx.on('mcp-servers/change', () => {
      const status = supervisor.list()[0]?.status
      if (status !== undefined) observed.push(status)
    })
    try {
      supervisor.sync({ echo: fixtureEntry() })
      await vi.waitFor(() => {
        expect(observed).toContain('ready')
      }, { timeout: MOUNT_TIMEOUT })
      expect(observed).toContain('connecting')
    } finally {
      await supervisor.dispose()
      await ctx.fiber.dispose()
    }
  }, 30_000)

  it('contains synchronous and asynchronous roster observer failures', async () => {
    const ctx = await mountRegistry()
    const supervisor = new McpServerSupervisor(ctx)
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    ctx.on('mcp-servers/change', () => { throw new Error('observer threw') })
    // oxlint-disable-next-line typescript/no-misused-promises -- deliberate rejection proves notification containment
    ctx.on('mcp-servers/change', () => Promise.reject(new Error('observer rejected')))
    let observed = 0
    ctx.on('mcp-servers/change', () => { observed += 1 })
    try {
      expect(() => { supervisor.sync({ parked: fixtureEntry({ enabled: false }) }) }).not.toThrow()
      await vi.waitFor(() => { expect(warnings).toHaveLength(2) })
      expect(observed).toBe(1)
      expect(warnings).toEqual([
        'mcp-servers/change listener threw: observer threw',
        'mcp-servers/change listener rejected: observer rejected',
      ])
    } finally {
      await supervisor.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('mounts an enabled entry, tracks it to ready, and registers its tools', async () => {
    const ctx = await mountRegistry()
    const supervisor = new McpServerSupervisor(ctx)
    try {
      supervisor.sync({ echo: fixtureEntry() })
      await vi.waitFor(() => {
        expect(supervisor.list()).toEqual([stateRow('echo', 'ready')])
      }, { timeout: MOUNT_TIMEOUT })
      expect(ctx.tools.get('mcp__echo__add')).toBeDefined()
      expect(ctx.tools.get('mcp__echo__greet')).toBeDefined()
      expect(ctx.tools.get('add')).toBeUndefined()
    } finally {
      await supervisor.dispose()
      await ctx.fiber.dispose()
    }
  }, 30_000)

  it('marks a fatal startup failure as failed with its message', async () => {
    const ctx = await mountRegistry()
    const supervisor = new McpServerSupervisor(ctx)
    try {
      supervisor.sync({
        broken: fixtureEntry({ command: 'dsh-not-a-real-command', failOnStartupError: true }),
      })
      await vi.waitFor(() => {
        const state = supervisor.list().find(row => row.serverName === 'broken')
        expect(state?.status).toBe('failed')
        expect(state?.error).toBeTruthy()
      }, { timeout: MOUNT_TIMEOUT })
      expect(ctx.tools.get('mcp__broken__add')).toBeUndefined()
    } finally {
      await supervisor.dispose()
      await ctx.fiber.dispose()
    }
  }, 30_000)

  it('disposes the old fiber before a remount mounts the new one', async () => {
    const ctx = await mountRegistry()
    const supervisor = new McpServerSupervisor(ctx)
    try {
      supervisor.sync({ echo: fixtureEntry() })
      await vi.waitFor(() => {
        expect(supervisor.list()).toEqual([stateRow('echo', 'ready')])
      }, { timeout: MOUNT_TIMEOUT })
      const before = supervisor.list()[0]

      // A same-name remount can only reach ready if the old fiber released
      // its serverName reservation first: mcp-client rejects duplicates.
      supervisor.sync({ echo: fixtureEntry({ toolCallTimeoutMs: 20_000 }) })
      await vi.waitFor(() => {
        expect(supervisor.list()).toEqual([stateRow('echo', 'ready')])
      }, { timeout: MOUNT_TIMEOUT })
      expect(supervisor.list()[0]).not.toBe(before)
      expect(ctx.tools.get('mcp__echo__add')).toBeDefined()
    } finally {
      await supervisor.dispose()
      await ctx.fiber.dispose()
    }
  }, 30_000)

  it('unregisters the old generation when a remount fails', async () => {
    const ctx = await mountRegistry()
    const supervisor = new McpServerSupervisor(ctx)
    try {
      supervisor.sync({ echo: fixtureEntry() })
      await vi.waitFor(() => {
        expect(supervisor.list()).toEqual([stateRow('echo', 'ready')])
      }, { timeout: MOUNT_TIMEOUT })

      supervisor.sync({ echo: fixtureEntry({ command: 'dsh-not-a-real-command', failOnStartupError: true }) })
      await vi.waitFor(() => {
        expect(supervisor.list()[0]?.status).toBe('failed')
      }, { timeout: MOUNT_TIMEOUT })
      expect(ctx.tools.get('mcp__echo__add')).toBeUndefined()
    } finally {
      await supervisor.dispose()
      await ctx.fiber.dispose()
    }
  }, 30_000)

  it('tears down the whole roster on dispose', async () => {
    const ctx = await mountRegistry()
    const supervisor = new McpServerSupervisor(ctx)
    supervisor.sync({ echo: fixtureEntry(), docs: fixtureEntry() })
    await vi.waitFor(() => {
      expect(supervisor.list()).toEqual([stateRow('echo', 'ready'), stateRow('docs', 'ready')])
    }, { timeout: MOUNT_TIMEOUT })

    await supervisor.dispose()
    expect(supervisor.list()).toEqual([])
    expect(ctx.tools.get('mcp__echo__add')).toBeUndefined()
    expect(ctx.tools.get('mcp__docs__add')).toBeUndefined()
    await ctx.fiber.dispose()
  }, 30_000)

  it('ignores a sync arriving after dispose', async () => {
    const ctx = await mountRegistry()
    const supervisor = new McpServerSupervisor(ctx)
    await supervisor.dispose()
    supervisor.sync({ echo: fixtureEntry() })
    expect(supervisor.list()).toEqual([])
    await ctx.fiber.dispose()
  })

  it('drops a settlement arriving after its mount was already removed', async () => {
    const ctx = await mountRegistry()
    const supervisor = new McpServerSupervisor(ctx)
    supervisor.sync({ echo: fixtureEntry() })
    // Wait for the mount to exist mid-connect, then remove it before the
    // fiber settles: the late settlement must not resurrect a state row.
    await vi.waitFor(() => {
      expect(supervisor.list()).toEqual([stateRow('echo', 'connecting')])
    }, { timeout: MOUNT_TIMEOUT })
    supervisor.sync({})
    await supervisor.dispose()
    expect(supervisor.list()).toEqual([])
    await ctx.fiber.dispose()
  }, 30_000)

  it('records a failed state when the host context is already disposed', async () => {
    const ctx = await mountRegistry()
    // Root fibers stay plugin-able after disposal; a disposed child fiber is
    // what makes ctx.plugin throw synchronously.
    const host = await ctx.plugin({ name: 'host', apply: () => {} })
    const supervisor = new McpServerSupervisor(host.ctx)
    await host.dispose()
    supervisor.sync({ echo: fixtureEntry() })
    await vi.waitFor(() => {
      const state = supervisor.list().find(row => row.serverName === 'echo')
      expect(state?.status).toBe('failed')
      expect(state?.error).toBeTruthy()
    })
    await supervisor.dispose()
    await ctx.fiber.dispose()
  })

  it('lets disposal win over a queued mount', async () => {
    const ctx = await mountRegistry()
    const supervisor = new McpServerSupervisor(ctx)
    supervisor.sync({ echo: fixtureEntry() })
    supervisor.sync({})
    // dispose() runs before the queued reconciles: the mount is skipped and
    // the queued dispose finds no mount to remove.
    await supervisor.dispose()
    expect(supervisor.list()).toEqual([])
    expect(ctx.tools.get('mcp__echo__add')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})

describe('mcp-manager settings wiring', () => {
  it('mounts on a settings commit and disposes on enabled: false', async () => {
    const { ctx } = await boot()
    try {
      // Non-empty env regresses the frozen-settings clone path: Schemastery
      // writes adapted dict entries back onto its input and strict-mode
      // assignment on a frozen map fails the whole mcp-client config check.
      await writeEntry(ctx, 'echo', { env: { DSH_FIXTURE_MARKER: 'frozen' } })
      await vi.waitFor(() => {
        expect(ctx.tools.get('mcp__echo__add')).toBeDefined()
      }, { timeout: MOUNT_TIMEOUT })

      await writeEntry(ctx, 'echo', { enabled: false })
      await vi.waitFor(() => {
        expect(ctx.tools.get('mcp__echo__add')).toBeUndefined()
      }, { timeout: MOUNT_TIMEOUT })
    } finally {
      await ctx.fiber.dispose()
    }
  }, 30_000)

  it('tears down the roster when the plugin unloads', async () => {
    const { ctx, manager } = await boot()
    try {
      await writeEntry(ctx, 'echo', {})
      await vi.waitFor(() => {
        expect(ctx.tools.get('mcp__echo__add')).toBeDefined()
      }, { timeout: MOUNT_TIMEOUT })

      await manager.dispose()
      await vi.waitFor(() => {
        expect(ctx.tools.get('mcp__echo__add')).toBeUndefined()
      }, { timeout: MOUNT_TIMEOUT })
    } finally {
      await ctx.fiber.dispose()
    }
  }, 30_000)
})
