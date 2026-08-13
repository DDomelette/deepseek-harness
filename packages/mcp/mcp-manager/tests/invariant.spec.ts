import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import * as McpManagerInvariant from '../src/invariant.ts'
import { MCP_CLIENT_MODULE } from '../src/declarative.ts'
import { MCP_SERVERS_NS, McpServersSchema } from '../src/schema.ts'
import { MemorySettings, fakeLoader, type FakeLoaderEntry } from './fixtures.ts'

const NS = settingsNamespace(MCP_SERVERS_NS)

const DECLARATIVE_MEMORIX: FakeLoaderEntry = {
  name: MCP_CLIENT_MODULE,
  config: { serverName: 'memorix', transport: 'stdio' },
}

async function setup(loaderEntries: FakeLoaderEntry[] = []) {
  const ctx = new Context()
  ctx.provide('loader', fakeLoader(loaderEntries) as never)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(MemorySettings)
  return ctx
}

describe('mcp-manager invariants', () => {
  it('accepts a pre-registered section without declarative collision', async () => {
    const ctx = await setup([DECLARATIVE_MEMORIX])
    ctx.settings.register(NS, McpServersSchema)
    await ctx.plugin(McpManagerInvariant)
  })

  it('fails when an already-stored section collides with a declarative server', async () => {
    const ctx = await setup([DECLARATIVE_MEMORIX])
    // No validate hook here: the invariant is the backstop for sections the
    // owner's registration never judged (stored before it mounted).
    ctx.settings.register(NS, McpServersSchema)
    await ctx.settings.update(NS, { memorix: { transport: 'stdio', command: 'x' } })
    await expect(ctx.plugin(McpManagerInvariant)).rejects.toThrow(/memorix/)
  })

  it('passes a committed update without declarative collision', async () => {
    const ctx = await setup()
    await ctx.plugin(McpManagerInvariant)
    ctx.settings.register(NS, McpServersSchema)
    await ctx.settings.update(NS, { alpha: { transport: 'stdio', command: 'x' } })
  })

  it('fails a committed update whose key collides with a declarative server', async () => {
    const ctx = await setup([DECLARATIVE_MEMORIX])
    await ctx.plugin(McpManagerInvariant)
    ctx.settings.register(NS, McpServersSchema)
    await expect(ctx.settings.update(NS, {
      memorix: { transport: 'stdio', command: 'x' },
    })).rejects.toThrow(/memorix/)
  })

  it('ignores updates to other namespaces', async () => {
    const ctx = await setup([DECLARATIVE_MEMORIX])
    await ctx.plugin(McpManagerInvariant)
    ctx.settings.register(settingsNamespace('other'), z.object({
      flag: z.boolean().default(false),
    }))
    await ctx.settings.update(settingsNamespace('other'), { flag: true })
  })

  it('ignores non-object payloads', async () => {
    const ctx = await setup()
    await ctx.plugin(McpManagerInvariant)
    ctx.settings.register(NS, McpServersSchema)
    ctx.emit('settings/updated', NS, 'forged', {}, 'update')
    ctx.emit('settings/updated', NS, null, {}, 'update')
  })
})
