import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import McpManager from '../src/index.ts'
import * as McpManagerInvariant from '../src/invariant.ts'
import { MCP_CLIENT_MODULE } from '../src/declarative.ts'
import type { McpStdioEntry } from '../src/schema.ts'
import { fakeLoader, mountSection, type FakeLoaderEntry } from './fixtures.ts'

const DECLARATIVE_MEMORIX: FakeLoaderEntry = {
  name: MCP_CLIENT_MODULE,
  config: { serverName: 'memorix', transport: 'stdio' },
}

/** Disabled stdio entry: the section carries the key, no process is ever spawned. */
function parked(over: Partial<McpStdioEntry> = {}): McpStdioEntry {
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

const booted: Context[] = []

afterEach(async () => {
  await Promise.all(booted.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function setup(loaderEntries: FakeLoaderEntry[] = [], section: Record<string, McpStdioEntry> = {}) {
  const ctx = new Context()
  ctx.provide('loader', fakeLoader(loaderEntries) as never)
  await ctx.plugin(InvariantRegistry)
  // The section is the mount-time config: a colliding one must already be
  // stored, because a live edit to the running manager is refused.
  const manager = await ctx.plugin(McpManager, mountSection(section))
  booted.push(ctx)
  return { ctx, manager }
}

describe('mcp-manager invariants', () => {
  it('accepts a stored section without declarative collision', async () => {
    const { ctx } = await setup([DECLARATIVE_MEMORIX], { alpha: parked() })
    await ctx.plugin(McpManagerInvariant)
  })

  it('fails when an already-stored section collides with a declarative server', async () => {
    // The live-edit gate never judged a section the composition stored before
    // the manager mounted; the invariant is that backstop.
    const { ctx } = await setup([DECLARATIVE_MEMORIX], { memorix: parked() })
    await expect(ctx.plugin(McpManagerInvariant)).rejects.toThrow(/memorix/)
  })

  it('passes a committed update without declarative collision', async () => {
    const { ctx, manager } = await setup()
    await ctx.plugin(McpManagerInvariant)
    await manager.update({ servers: { alpha: parked() } })
  })

  it('never sees a live edit whose key collides with a declarative server', async () => {
    const { ctx, manager } = await setup([DECLARATIVE_MEMORIX])
    await ctx.plugin(McpManagerInvariant)
    // The write path refuses the collision before it is persisted, so the
    // section the invariant observes stays non-intersecting.
    expect(() => manager.update({ servers: { memorix: parked() } })).toThrow(/memorix/)
  })

  it('accepts a section when the composition declares no server', async () => {
    const { ctx } = await setup([], { memorix: parked() })
    await ctx.plugin(McpManagerInvariant)
  })

  it('accepts a manager whose section names no server', async () => {
    const { ctx } = await setup([DECLARATIVE_MEMORIX])
    await ctx.plugin(McpManagerInvariant)
  })
})
