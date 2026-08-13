import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import UsageTelemetry from '../src/index.ts'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-home-'))
  process.env.DSH_HOME = home
})

afterEach(async () => {
  delete process.env.DSH_HOME
  await rm(home, { recursive: true, force: true })
})

function fakeSession(id: string, cwd?: string): Session {
  return {
    id,
    header: { version: 0, id, createdAt: 0, ...(cwd === undefined ? {} : { cwd }) },
    events: [],
  } as unknown as Session
}

function headerEvent(session: Session, model: string, seq: number): SessionEvent {
  return { type: 'request/header', seq, time: 1000, data: { header: { version: 0, createdAt: 0, config: { provider: 'p', model } }, reason: 'initial' } } as SessionEvent
}

function usageEvent(
  session: Session,
  seq: number,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number },
): SessionEvent {
  return { type: 'assistant/message', seq, time: 2000, data: { turn: 1, step: 1, usage } } as SessionEvent
}

async function telemetryRoot(): Promise<string> {
  return join(home, 'telemetry')
}

async function readRows(): Promise<string[]> {
  const root = await telemetryRoot()
  const { readdir } = await import('node:fs/promises')
  const files = await readdir(root).catch(() => [] as string[])
  const lines: string[] = []
  for (const file of files) {
    lines.push(...(await readFile(join(root, file), 'utf8')).trim().split('\n').filter(Boolean))
  }
  return lines
}

describe('UsageTelemetry service', () => {
  it('writes one row per assistant/message with usage, with model from the latest request/header', async () => {
    const ctx = new Context()
    await ctx.plugin(UsageTelemetry, { enabled: true })
    const session = fakeSession('session-1', 'D:\\Deepseek_Monitor')
    ctx.emit('session/event', session, headerEvent(session, 'deepseek-v4-pro', 0))
    ctx.emit('session/event', session, usageEvent(session, 1, { inputTokens: 1404, outputTokens: 1089, cacheReadTokens: 46592, cacheWriteTokens: 0 }))
    // Give the fire-and-forget append a tick to land.
    await new Promise(resolve => setTimeout(resolve, 50))
    const rows = await readRows()
    expect(rows).toHaveLength(1)
    const parsed = JSON.parse(rows[0]!)
    expect(parsed).toEqual({
      v: 1, time: 2000, sessionId: 'session-1', cwd: 'D:\\Deepseek_Monitor', model: 'deepseek-v4-pro',
      inputTokens: 1404, outputTokens: 1089, cacheReadTokens: 46592, cacheWriteTokens: 0,
    })
  })

  it('ignores usage chunks and messages without usage, and omits model when no header was seen', async () => {
    const ctx = new Context()
    await ctx.plugin(UsageTelemetry, { enabled: true })
    const session = fakeSession('session-2')
    ctx.emit('session/event', session, { type: 'assistant/chunk', seq: 0, time: 1, data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 9, outputTokens: 9 } } } } as SessionEvent)
    ctx.emit('session/event', session, { type: 'assistant/message', seq: 1, time: 2, data: { turn: 1, step: 1 } } as SessionEvent)
    ctx.emit('session/event', session, usageEvent(session, 2, { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 1 }))
    await new Promise(resolve => setTimeout(resolve, 50))
    const rows = await readRows()
    expect(rows).toHaveLength(1)
    const parsed = JSON.parse(rows[0]!)
    expect(parsed.model).toBeUndefined()
    expect(parsed.inputTokens).toBe(10)
    expect(parsed.cacheWriteTokens).toBe(1)
  })

  it('does not subscribe or write when disabled', async () => {
    const ctx = new Context()
    await ctx.plugin(UsageTelemetry, { enabled: false })
    const session = fakeSession('session-3')
    ctx.emit('session/event', session, usageEvent(session, 0, { inputTokens: 1, outputTokens: 1 }))
    await new Promise(resolve => setTimeout(resolve, 50))
    await expect(readRows()).resolves.toEqual([])
  })

  it('contains write failures: a broken telemetry path never throws into the event path', async () => {
    const ctx = new Context()
    await ctx.plugin(UsageTelemetry, { enabled: true })
    // A FILE occupying the telemetry path: appendFile fails with ENOTDIR/EEXIST-family errors.
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(home, 'telemetry'), 'blocker')
    const session = fakeSession('session-4')
    expect(() => {
      ctx.emit('session/event', session, usageEvent(session, 0, { inputTokens: 1, outputTokens: 1 }))
    }).not.toThrow()
  })

  it('a mounted settings scope can disable a previously enabled service', async () => {
    const ctx = new Context()
    let current = { enabled: true }
    const scope = {
      get: () => current,
      watch: (cb: () => void) => { watchCallback = cb },
    }
    let watchCallback: () => void = () => {}
    ctx.provide('settings', {
      register: () => scope,
    })
    await ctx.plugin(UsageTelemetry, { enabled: true })
    // Still enabled through the base value: a write lands.
    const session = fakeSession('session-5')
    ctx.emit('session/event', session, usageEvent(session, 0, { inputTokens: 1, outputTokens: 1 }))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(await readRows()).toHaveLength(1)
    // Flip through settings and confirm the subscription drops off.
    current = { enabled: false }
    watchCallback()
    ctx.emit('session/event', session, usageEvent(session, 1, { inputTokens: 2, outputTokens: 2 }))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(await readRows()).toHaveLength(1)
  })
})
