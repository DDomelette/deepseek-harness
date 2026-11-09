/** The settings panel reads the current manager and declarative Loader entries. */
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context, FiberState } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import McpManager from '../src/index.ts'
import type { McpPanelRemote } from '../src/panel.ts'

const fixtureServerPath = fileURLToPath(new URL('../../mcp-client/tests/fixture-server.ts', import.meta.url))
const declarative = [
  { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'docs', transport: 'streamable-http', headers: { authorization: 'secret' } }, fiberState: FiberState.ACTIVE },
  { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'legacy', transport: 'stdio', env: { TOKEN: 'secret' } }, disabled: true },
]

async function boot(servers: NonNullable<Parameters<typeof McpManager.Config>[0]>['servers'] = {}) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  // Only entries() is read; no Loader lifecycle is exercised by this fixture.
  ctx.provide('loader', {
    entries: () => declarative.map((entry, index) => ({
      id: String(index), options: { name: entry.name, config: entry.config },
      disabled: 'disabled' in entry && entry.disabled,
      fiber: 'fiberState' in entry ? { state: entry.fiberState } : undefined,
    })),
  } as never)
  const fiber = ctx.plugin(McpManager, { servers })
  await fiber.await()
  const panel = ctx.get('mcpServers') as McpPanelRemote
  return { ctx, fiber, panel }
}

describe('MCP panel Remote', () => {
  it('publishes only the direct list operation', async () => {
    const { panel } = await boot()
    expect(panel.typertRemote).toMatchObject({ serviceKey: 'mcpServers', namespace: 'mcpServers' })
    expect(remoteMethods(panel)).toEqual([{ method: 'list', invocation: { kind: 'direct' } }])
  })

  it('combines configured and declarative rows without disclosing credentials', async () => {
    const { panel } = await boot({ off: { enabled: false, transport: 'stdio', command: 'cmd', env: { SECRET: 'hidden' } } })
    expect(panel.list().entries).toEqual([
      { serverName: 'off', transport: 'stdio', source: 'settings', enabled: false, status: null },
      { serverName: 'docs', transport: 'streamable-http', source: 'declarative', enabled: true, status: null },
      { serverName: 'legacy', transport: 'stdio', source: 'declarative', enabled: false, status: null },
    ])
  })

  it('rejects a configured name already owned by a declarative entry', async () => {
    await expect(boot({ docs: { enabled: false, transport: 'stdio', command: 'cmd' } }))
      .rejects.toThrow('already declares this server name')
  })

  it('projects the manager connection state', async () => {
    const { panel } = await boot({ echo: { transport: 'stdio', command: process.execPath, args: [fixtureServerPath] } })
    await vi.waitFor(() => {
      expect(panel.list().entries).toContainEqual({
        serverName: 'echo', transport: 'stdio', source: 'settings', enabled: true, status: 'ready',
      })
    }, { timeout: 15_000 })
  }, 30_000)

  it('reports startup failure through the panel and survives a throwing observer', async () => {
    const { ctx, panel } = await boot({ broken: {
      transport: 'stdio', command: 'dsh-not-a-real-command', reconnect: { enabled: false },
    } })
    const notified = vi.fn()
    ctx.on('mcp-servers/change', () => { throw new Error('observer failed') })
    ctx.on('mcp-servers/change', notified)

    await vi.waitFor(() => {
      const entry = panel.list().entries.find(entry => entry.serverName === 'broken')
      expect(entry?.status).toBe('failed')
      expect(entry?.error).toBeTypeOf('string')
      expect(notified).toHaveBeenCalled()
    }, { timeout: 15_000 })
  }, 30_000)
})
