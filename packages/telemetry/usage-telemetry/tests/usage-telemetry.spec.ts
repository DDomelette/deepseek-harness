import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { canonicalHeader, SessionId } from '@deepseek-ai/dsh-session'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import UsageTelemetry, { USAGE_TELEMETRY_SETTINGS_NAMESPACE } from '../src/index.ts'

const appendState = vi.hoisted(() => ({
  holdAppend: false,
  appendStarted: undefined as (() => void) | undefined,
  continueAppend: undefined as Promise<void> | undefined,
  rejectAppend: false,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    appendFile: (async (path: unknown, ...rest: never[]) => {
      if (appendState.holdAppend) {
        appendState.holdAppend = false
        appendState.appendStarted!()
        await appendState.continueAppend!
      }
      if (appendState.rejectAppend) {
        appendState.rejectAppend = false
        throw new Error('injected append failure')
      }
      return (actual.appendFile as (path: unknown, ...args: never[]) => Promise<void>)(path, ...rest)
    }) as typeof actual.appendFile,
  }
})

let home: string
const roots: Context[] = []

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-home-'))
  process.env.DSH_HOME = home
})

afterEach(async () => {
  vi.restoreAllMocks()
  appendState.holdAppend = false
  appendState.appendStarted = undefined
  appendState.continueAppend = undefined
  appendState.rejectAppend = false
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  delete process.env.DSH_HOME
  await rm(home, { recursive: true, force: true })
})

async function setup(enabled = true, withSessions = false): Promise<Context> {
  const ctx = new Context()
  roots.push(ctx)
  if (withSessions) await ctx.plugin(SessionStore)
  await ctx.plugin(UsageTelemetry, { enabled })
  return ctx
}

function options(sessionId?: GenerateOptions['sessionId'], model = 'deepseek-v4-pro', purpose?: GenerateOptions['purpose']): GenerateOptions {
  return { provider: 'deepseek', model, messages: [], ...(sessionId === undefined ? {} : { sessionId }), ...(purpose === undefined ? {} : { purpose }) }
}

async function* source(chunks: readonly StreamChunk[]): AsyncIterable<StreamChunk> {
  yield* chunks
}

function openStream(ctx: Context, request: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
  return ctx.waterfall(ctx as never, 'llm/stream', request, next)
}

async function consume(ctx: Context, request: GenerateOptions, chunks: readonly StreamChunk[]): Promise<StreamChunk[]> {
  const consumed: StreamChunk[] = []
  for await (const chunk of openStream(ctx, request, () => source(chunks))) consumed.push(chunk)
  return consumed
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const consumed: StreamChunk[] = []
  for await (const chunk of stream) consumed.push(chunk)
  return consumed
}

async function rows(): Promise<Record<string, unknown>[]> {
  const root = join(home, 'telemetry')
  const { readdir } = await import('node:fs/promises')
  const files = await readdir(root).catch(() => [] as string[])
  const lines = await Promise.all(files.filter(file => /^usage-.*\.jsonl$/.test(file)).map(async file =>
    (await readFile(join(root, file), 'utf8')).split('\n').filter(Boolean),
  ))
  return lines.flat().map(line => JSON.parse(line) as Record<string, unknown>)
}

async function expectRows(count: number): Promise<Record<string, unknown>[]> {
  await vi.waitFor(async () => { expect(await rows()).toHaveLength(count) })
  return rows()
}

const finish: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }

/** The smallest real settings provider: one writable in-memory document. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

describe('UsageTelemetry service', () => {
  it('writes one frozen v1 row after a session-scoped stream yields usage', async () => {
    const ctx = await setup()
    vi.spyOn(Date, 'now').mockReturnValue(1710000000000)

    await expect(consume(ctx, options(SessionId('stream-1')), [{ type: 'usage', usage: { inputTokens: 1404, outputTokens: 1089, cacheReadTokens: 46592, cacheWriteTokens: 0 } }, finish])).resolves.toEqual([
      { type: 'usage', usage: { inputTokens: 1404, outputTokens: 1089, cacheReadTokens: 46592, cacheWriteTokens: 0 } }, finish,
    ])

    await expect(expectRows(1)).resolves.toEqual([{
      v: 1, time: 1710000000000, sessionId: 'stream-1', model: 'deepseek-v4-pro',
      inputTokens: 1404, outputTokens: 1089, cacheReadTokens: 46592, cacheWriteTokens: 0,
    }])
  })

  it('uses the live session cwd, exact model, usage-arrival time, and every v1 counter', async () => {
    const ctx = await setup(true, true)
    const sessionId = SessionId('stream-cwd')
    ctx.sessions.create(sessionId, { meta: { cwd: 'D:\\project' } })
    vi.spyOn(Date, 'now').mockReturnValue(1710000000001)

    await consume(ctx, options(sessionId, 'deepseek-v4-reasoner'), [{ type: 'usage', usage: { inputTokens: 8, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2 } }, finish])

    await expect(expectRows(1)).resolves.toEqual([{
      v: 1, time: 1710000000001, sessionId: 'stream-cwd', cwd: 'D:\\project', model: 'deepseek-v4-reasoner',
      inputTokens: 8, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2,
    }])
  })

  it('omits cwd when the session id is not live while retaining usage', async () => {
    const ctx = await setup(true, true)
    vi.spyOn(Date, 'now').mockReturnValue(1710000000002)
    await consume(ctx, options(SessionId('missing-session')), [{ type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } }, finish])
    await expect(expectRows(1)).resolves.toEqual([{
      v: 1, time: 1710000000002, sessionId: 'missing-session', model: 'deepseek-v4-pro',
      inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0,
    }])
  })

  it('does not write without a session id or a usage chunk', async () => {
    const ctx = await setup()
    await consume(ctx, options(), [{ type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }, finish])
    await consume(ctx, options(SessionId('no-usage')), [finish])
    await new Promise(resolve => setTimeout(resolve, 20))
    await expect(rows()).resolves.toEqual([])
  })

  it('records usage before a terminal error finish', async () => {
    const ctx = await setup()
    await consume(ctx, options(SessionId('error-finish')), [{ type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } }, { type: 'finish', reason: { kind: 'error', failure: { message: 'remote error', code: 'PROVIDER_ERROR' } } }])
    await expectRows(1)
  })

  it('records usage when downstream throws while preserving the original error', async () => {
    const ctx = await setup()
    const stream = openStream(ctx, options(SessionId('throws')), async function* () {
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } }
      throw new Error('downstream failed')
    })
    await expect(collect(stream)).rejects.toThrow('downstream failed')
    await expectRows(1)
  })

  it('records usage when the consumer returns from the iterator early', async () => {
    const ctx = await setup()
    const iterator = openStream(ctx, options(SessionId('returned')), () => source([{ type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } }, finish]))[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.return?.()
    await expectRows(1)
  })

  it('writes one row for each retry-like stream listener invocation', async () => {
    const ctx = await setup()
    await consume(ctx, options(SessionId('retry')), [{ type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }, finish])
    await consume(ctx, options(SessionId('retry')), [{ type: 'usage', usage: { inputTokens: 2, outputTokens: 2 } }, finish])
    const recorded = await expectRows(2)
    expect(recorded.map(row => row.inputTokens)).toEqual([1, 2])
  })

  it('records compaction usage with only frozen v1 fields', async () => {
    const ctx = await setup()
    vi.spyOn(Date, 'now').mockReturnValue(1710000000005)
    await consume(ctx, options(SessionId('compact'), 'deepseek-v4-pro', 'compaction'), [{ type: 'usage', usage: { inputTokens: 1, outputTokens: 2, reasoningTokens: 99 } }, finish])
    await expect(expectRows(1)).resolves.toEqual([{
      v: 1, time: 1710000000005, sessionId: 'compact', model: 'deepseek-v4-pro',
      inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0,
    }])
  })

  it('keeps the last usage chunk and its arrival time', async () => {
    const ctx = await setup()
    vi.spyOn(Date, 'now').mockReturnValueOnce(1710000000003).mockReturnValueOnce(1710000000004)
    await consume(ctx, options(SessionId('last-usage')), [
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 4, cacheReadTokens: 5, cacheWriteTokens: 6 } }, finish,
    ])
    await expect(expectRows(1)).resolves.toEqual([{
      v: 1, time: 1710000000004, sessionId: 'last-usage', model: 'deepseek-v4-pro',
      inputTokens: 3, outputTokens: 4, cacheReadTokens: 5, cacheWriteTokens: 6,
    }])
  })

  it('does not duplicate a stream row after legacy session events', async () => {
    const ctx = await setup(true, true)
    const sessionId = SessionId('no-duplicate')
    const session = ctx.sessions.create(sessionId)
    vi.spyOn(Date, 'now').mockReturnValue(1710000000006)
    await consume(ctx, options(sessionId), [{ type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } }, finish])
    session.append('request/header', {
      header: canonicalHeader({ config: { provider: 'deepseek', model: 'legacy-model' } }),
      reason: 'initial',
    })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [],
        source: { kind: 'model', provider: 'deepseek', model: 'legacy-model' },
      }),
      usage: { inputTokens: 7, outputTokens: 8 },
    }, { surfaceOp: 'append' })
    await expect(expectRows(1)).resolves.toEqual([{
      v: 1, time: 1710000000006, sessionId: 'no-duplicate', model: 'deepseek-v4-pro',
      inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0,
    }])
  })

  it('leaves disabled streams unchanged and writes nothing', async () => {
    const ctx = await setup(false)
    const chunks: StreamChunk[] = [{ type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } }, finish]
    await expect(consume(ctx, options(SessionId('disabled')), chunks)).resolves.toEqual(chunks)
    await new Promise(resolve => setTimeout(resolve, 20))
    await expect(rows()).resolves.toEqual([])
  })

  it('restores the composition setting after the settings provider detaches', async () => {
    const ctx = new Context()
    roots.push(ctx)
    const settingsFiber = ctx.plugin(MemorySettings)
    await settingsFiber
    await ctx.plugin(UsageTelemetry, { enabled: true })

    await ctx.settings.replace(USAGE_TELEMETRY_SETTINGS_NAMESPACE, { enabled: false })
    await consume(ctx, options(SessionId('provider-disabled')), [{ type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } }, finish])
    await new Promise(resolve => setTimeout(resolve, 20))
    await expect(rows()).resolves.toEqual([])

    await settingsFiber.dispose()
    await consume(ctx, options(SessionId('provider-detached')), [{ type: 'usage', usage: { inputTokens: 3, outputTokens: 4 } }, finish])
    await expectRows(1)
  })

  it('rejudges the stream subscription after a committed settings update', async () => {
    const ctx = new Context()
    roots.push(ctx)
    const settingsFiber = ctx.plugin(MemorySettings)
    await settingsFiber
    await ctx.plugin(UsageTelemetry, { enabled: true })

    await ctx.settings.replace(USAGE_TELEMETRY_SETTINGS_NAMESPACE, { enabled: false })
    await consume(ctx, options(SessionId('settings-false')), [{ type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } }, finish])
    await new Promise(resolve => setTimeout(resolve, 20))
    await expect(rows()).resolves.toEqual([])

    await ctx.settings.replace(USAGE_TELEMETRY_SETTINGS_NAMESPACE, { enabled: true })
    await consume(ctx, options(SessionId('settings-true')), [{ type: 'usage', usage: { inputTokens: 3, outputTokens: 4 } }, finish])
    await expectRows(1)
  })

  it('uses the composition setting when no settings provider is mounted', async () => {
    const enabled = await setup(true)
    await consume(enabled, options(SessionId('composition-true')), [{ type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } }, finish])
    await expectRows(1)

    const disabled = await setup(false)
    await consume(disabled, options(SessionId('composition-false')), [{ type: 'usage', usage: { inputTokens: 3, outputTokens: 4 } }, finish])
    await new Promise(resolve => setTimeout(resolve, 20))
    await expectRows(1)
  })

  it('waits for an in-flight append before service disposal resolves', async () => {
    const ctx = new Context()
    roots.push(ctx)
    const fiber = ctx.plugin(UsageTelemetry, { enabled: true })
    await fiber
    let markAppendStarted!: () => void
    const appendStarted = new Promise<void>((resolve) => { markAppendStarted = resolve })
    let releaseAppend!: () => void
    appendState.continueAppend = new Promise<void>((resolve) => { releaseAppend = resolve })
    appendState.appendStarted = markAppendStarted
    appendState.holdAppend = true
    let disposing: Promise<void> | undefined

    try {
      await consume(ctx, options(SessionId('dispose-drain')), [{ type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } }, finish])
      await appendStarted
      let disposed = false
      disposing = fiber.dispose()
      void disposing.then(() => { disposed = true })
      await Promise.resolve()
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(disposed).toBe(false)
    } finally {
      releaseAppend()
      await disposing
    }

    await expectRows(1)
  })

  it('contains a rejected writer promise while allowing service disposal', async () => {
    const ctx = new Context()
    roots.push(ctx)
    const fiber = ctx.plugin(UsageTelemetry, { enabled: true })
    await fiber
    const warn = vi.spyOn(ctx.logger, 'warn')
    appendState.rejectAppend = true

    await expect(consume(ctx, options(SessionId('writer-rejection')), [{ type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } }, finish])).resolves.toEqual([
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } }, finish,
    ])
    await expect(fiber.dispose()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('usage telemetry: write failed: Error: injected append failure'))
  })

  it('does not record a wrapper that finalizes after service teardown starts', async () => {
    const ctx = new Context()
    roots.push(ctx)
    const fiber = ctx.plugin(UsageTelemetry, { enabled: true })
    await fiber
    let releaseSource!: () => void
    const sourceRelease = new Promise<void>((resolve) => { releaseSource = resolve })
    const iterator = openStream(ctx, options(SessionId('late-finalize')), async function* () {
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } }
      await sourceRelease
      yield finish
    })[Symbol.asyncIterator]()
    await iterator.next()

    const disposing = fiber.dispose()
    releaseSource()
    await expect(iterator.next()).resolves.toEqual({ value: finish, done: false })
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true })
    await disposing
    await new Promise(resolve => setTimeout(resolve, 20))
    await expect(rows()).resolves.toEqual([])
  })

  it('remounts with one listener after the prior service is disposed', async () => {
    const ctx = new Context()
    roots.push(ctx)
    const first = ctx.plugin(UsageTelemetry, { enabled: true })
    await first
    await first.dispose()

    await consume(ctx, options(SessionId('disposed-instance')), [{ type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } }, finish])
    await new Promise(resolve => setTimeout(resolve, 20))
    await expect(rows()).resolves.toEqual([])

    await ctx.plugin(UsageTelemetry, { enabled: true })
    await consume(ctx, options(SessionId('remounted-instance')), [{ type: 'usage', usage: { inputTokens: 3, outputTokens: 4 } }, finish])
    const recorded = await expectRows(1)
    expect(recorded[0]?.sessionId).toBe('remounted-instance')
  })

  it('contains invalid provider usage without rejecting stream consumption', async () => {
    const ctx = await setup()
    const warn = vi.spyOn(ctx.logger, 'warn')
    const chunks: StreamChunk[] = [
      { type: 'usage', usage: { inputTokens: -1, outputTokens: 2 } }, finish,
    ]

    await expect(consume(ctx, options(SessionId('invalid-usage')), chunks)).resolves.toEqual(chunks)
    await expect(rows()).resolves.toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('usage telemetry: capture step failed:'))
  })

  it('contains broken telemetry writes without rejecting stream consumption', async () => {
    const ctx = await setup()
    await writeFile(join(home, 'telemetry'), 'blocker')
    await expect(consume(ctx, options(SessionId('broken')), [{ type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } }, finish])).resolves.toEqual([
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } }, finish,
    ])
  })
})
