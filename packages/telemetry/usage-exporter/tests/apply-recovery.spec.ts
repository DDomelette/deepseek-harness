import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Config, apply } from '../src/index.ts'
import { rootIdFor } from '../src/apply.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const ROW = { v: 1, time: 1, sessionId: 'test-session', inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
const endpoint = 'https://usage.example.invalid/ingest'
type BatchPayload = { batchId: string; sourceId: string; rows: unknown[] }

async function bench(overrides: Partial<Config> = {}, initial = JSON.stringify(ROW) + '\n') {
  const root = await mkdtemp(join(tmpdir(), 'usage-exporter-recovery-'))
  roots.push(root)
  const telemetryRoot = join(root, 'telemetry')
  await mkdir(telemetryRoot)
  const file = join(telemetryRoot, 'usage-2026-08-16.jsonl')
  if (initial !== '') await writeFile(file, initial)
  const ctx = new Context()
  contexts.push(ctx)
  const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  const cursorPath = join(root, 'cursor.json')
  const config = Config({
    endpoint, telemetryRoot, cursorPath, sourceId: 'test-source', startFrom: 'beginning',
    token: '', maxBatchRows: 200, maxBatchBytes: 262_144,
    pollIntervalMs: 250, heartbeatIntervalMs: 5000, requestTimeoutMs: 30000,
    maxAttempts: 3, baseRetryMs: 100, maxRetryMs: 200, ...overrides,
  })
  const fiber = ctx.plugin({ name: 'usage-exporter', apply }, config)
  await fiber.await()
  return { ctx, fiber, warn, file, telemetryRoot, cursorPath }
}

async function cursorOffset(path: string, file: string): Promise<number | undefined> {
  const state = JSON.parse(await readFile(path, 'utf8')) as { files: Record<string, { offset: number }> }
  return state.files[file]?.offset
}

describe('usage exporter recovery and disposal', () => {
  it.each(['duplicate', 'permanent', 'abandoned'] as const)('settles a %s batch and preserves its file for backfill', async (outcome) => {
    vi.useFakeTimers()
    const payloads: BatchPayload[] = []
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(input).toBe(endpoint)
      const body = init?.body
      if (typeof body !== 'string') throw new Error('expected a JSON request body')
      payloads.push(JSON.parse(body) as BatchPayload)
      if (outcome === 'duplicate') return Response.json({ ok: true, duplicates: 1 })
      return new Response('unavailable', { status: outcome === 'permanent' ? 400 : 503 })
    })
    const b = await bench({}, '{bad\n' + JSON.stringify(ROW) + '\n')
    await vi.waitFor(async () => { expect(await cursorOffset(b.cursorPath, b.file)).toBeGreaterThan(0) })
    expect(request).toHaveBeenCalledTimes(outcome === 'abandoned' ? 3 : 1)
    expect(new Set(payloads.map(payload => payload.batchId)).size).toBe(1)
    expect(payloads.every(payload => payload.sourceId === 'test-source')).toBe(true)
    expect(payloads[0]!.rows).toEqual([ROW])
    expect(b.warn).toHaveBeenCalledWith(expect.stringContaining('skipped malformed row'))
    if (outcome !== 'duplicate') {
      expect(b.warn).toHaveBeenCalledWith(expect.stringContaining(outcome === 'permanent' ? 'dropping batch' : 'abandoning batch'))
    }
    expect(await readFile(b.file, 'utf8')).toBe('{bad\n' + JSON.stringify(ROW) + '\n')
  })

  it('keeps a pending batch single-flight and drains it before disposal settles', async () => {
    vi.useFakeTimers()
    const accepted = Promise.withResolvers<Response>()
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(() => accepted.promise)
    const b = await bench()
    let disposal: Promise<void> | undefined
    try {
      await vi.waitFor(() => { expect(request).toHaveBeenCalledOnce() })
      await vi.advanceTimersByTimeAsync(1000)
      expect(request).toHaveBeenCalledOnce()
      let disposed = false
      disposal = b.fiber.dispose().then(() => { disposed = true })
      await vi.advanceTimersByTimeAsync(5000)
      expect(disposed).toBe(false)
      expect(request).toHaveBeenCalledOnce()
    } finally {
      accepted.resolve(Response.json({ ok: true, accepted: 1 }))
      await disposal
    }
    expect(await cursorOffset(b.cursorPath, b.file)).toBe(Buffer.byteLength(JSON.stringify(ROW) + '\n'))
    await vi.advanceTimersByTimeAsync(10000)
    expect(request).toHaveBeenCalledOnce()
  })

  it.each([200, 400, 503])('reports heartbeat status %i and waits for its pending request on unload', async (status) => {
    vi.useFakeTimers()
    const reply = Promise.withResolvers<Response>()
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      const body = init?.body
      if (typeof body !== 'string') throw new Error('expected a JSON request body')
      const payload: unknown = JSON.parse(body)
      expect(payload).toMatchObject({ heartbeat: true, sourceId: 'test-source' })
      return reply.promise
    })
    const b = await bench({}, '')
    let disposal: Promise<void> | undefined
    try {
      await vi.advanceTimersByTimeAsync(5000)
      expect(request).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(5000)
      expect(request).toHaveBeenCalledOnce()
      let disposed = false
      disposal = b.fiber.dispose().then(() => { disposed = true })
      await vi.advanceTimersByTimeAsync(5000)
      expect(disposed).toBe(false)
      expect(request).toHaveBeenCalledOnce()
    } finally {
      reply.resolve(status === 200 ? Response.json({ ok: true, heartbeat: true }) : new Response('heartbeat unavailable', { status }))
      await disposal
    }
    if (status === 200) expect(b.warn).not.toHaveBeenCalled()
    else expect(b.warn).toHaveBeenCalledWith('usage-exporter: heartbeat failed: heartbeat unavailable')
    await vi.advanceTimersByTimeAsync(10000)
    expect(request).toHaveBeenCalledOnce()
  })

  it('logs a missing telemetry directory and resumes polling after it is restored', async () => {
    vi.useFakeTimers()
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true, accepted: 1 }))
    const b = await bench({}, '')
    await vi.waitFor(async () => { expect(JSON.parse(await readFile(b.cursorPath, 'utf8'))).toEqual({ version: 1, files: {} }) })
    await rm(b.telemetryRoot, { recursive: true, force: true })
    await vi.advanceTimersByTimeAsync(250)
    await vi.waitFor(() => { expect(b.warn).toHaveBeenCalledWith(expect.stringContaining('poll failed:')) })
    await mkdir(b.telemetryRoot)
    await appendFile(b.file, JSON.stringify(ROW) + '\n')
    await vi.waitFor(() => { expect(request).toHaveBeenCalledOnce() })
    await vi.waitFor(async () => { expect(await cursorOffset(b.cursorPath, b.file)).toBeGreaterThan(0) })
  })

  it.each(['win32', 'linux'])('uses %s path spelling when deriving the root id', (value) => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    try {
      Object.defineProperty(process, 'platform', { ...platform, value })
      expect(rootIdFor('C:\\Telemetry\\USAGE') === rootIdFor('c:/telemetry/usage')).toBe(value === 'win32')
    } finally {
      Object.defineProperty(process, 'platform', platform)
    }
  })
})
