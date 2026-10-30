import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import * as exporter from '../src/index.ts'
import { CursorStore } from '../src/cursor-store.ts'
import { UsageTailReader } from '../src/tail.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('disposes during cursor initialization without starting polls or heartbeats, then reloads', async () => {
  vi.useFakeTimers()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const ctx = new Context()
  onTestFinished(async () => {
    release.resolve(undefined)
    await ctx.fiber.dispose()
  })
  vi.spyOn(CursorStore.prototype, 'load').mockImplementationOnce(async () => {
    entered.resolve(undefined)
    await release.promise
  }).mockResolvedValue(undefined)
  const read = vi.spyOn(UsageTailReader.prototype, 'nextBatch').mockResolvedValue(undefined)
  const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    expect(input).toBe('https://usage.example.invalid/ingest')
    return Response.json({ ok: true, heartbeat: true })
  })
  const config = exporter.Config({
    endpoint: 'https://usage.example.invalid/ingest', sourceId: 'initialization-test',
    telemetryRoot: '/unused-telemetry', cursorPath: '/unused-cursor',
    pollIntervalMs: 250, heartbeatIntervalMs: 5000,
    token: '', startFrom: 'end', maxBatchRows: 200, maxBatchBytes: 262_144,
    requestTimeoutMs: 30_000, maxAttempts: 3, baseRetryMs: 100, maxRetryMs: 200,
  })
  const fiber = ctx.plugin(exporter, config)
  await entered.promise
  const disposal = fiber.dispose()
  expect(fiber.uid).toBeNull()
  release.resolve(undefined)
  await disposal

  await vi.advanceTimersByTimeAsync(10_000)
  expect(read).not.toHaveBeenCalled()
  expect(request).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)

  const reloaded = ctx.plugin(exporter, config)
  await reloaded.await()
  expect(read).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(5000)
  expect(request).toHaveBeenCalledOnce()
  await reloaded.dispose()
  const reads = read.mock.calls.length
  await vi.advanceTimersByTimeAsync(10_000)
  expect(read).toHaveBeenCalledTimes(reads)
  expect(request).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
