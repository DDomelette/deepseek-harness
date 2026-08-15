/** Poll/retry/cursor loop behind the usage exporter plugin. */

import { createHash } from 'node:crypto'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { CursorStore } from './cursor-store.ts'
import { BatchSender } from './sender.ts'
import { UsageTailReader } from './tail.ts'
import type { Config } from './index.ts'

export async function runExporter(ctx: Context, config: Config): Promise<void> {
  const sourceId = config.sourceId.length > 0 ? config.sourceId : defaultSourceId()
  const root = config.telemetryRoot ?? join(resolveDshHome(), 'telemetry')
  const rootId = rootIdFor(root)
  const cursor = new CursorStore(config.cursorPath ?? dshHomePath('storages', 'usage-exporter.json'))
  await cursor.load()
  const sender = new BatchSender({
    endpoint: config.endpoint,
    token: config.token,
    sourceId,
    rootId,
    requestTimeoutMs: config.requestTimeoutMs,
  })
  const reader = new UsageTailReader({
    root, sourceId, cursorStore: cursor, startFrom: config.startFrom,
    maxBatchBytes: config.maxBatchBytes, maxBatchRows: config.maxBatchRows,
    logMalformed: (file, message) => { ctx.logger.warn(`usage-exporter: skipped malformed row in ${file}: ${message}`) },
  })

  let inFlight: Promise<void> | undefined
  const tick = (): void => {
    if (inFlight !== undefined) return
    inFlight = (async () => {
      const batch = await reader.nextBatch()
      if (batch === undefined) return
      for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
        const outcome = await sender.send(batch.rows, batch.batchId)
        if (outcome.kind === 'accepted' || outcome.kind === 'duplicate') break
        if (outcome.kind === 'permanent') {
          ctx.logger.warn(`usage-exporter: dropping batch ${batch.batchId}: ${outcome.status ?? ''} ${outcome.message}`)
          break
        }
        if (attempt < config.maxAttempts) {
          const delay = Math.min(config.baseRetryMs * 2 ** (attempt - 1), config.maxRetryMs)
          await new Promise(resolve => setTimeout(resolve, delay))
        } else {
          ctx.logger.warn(`usage-exporter: abandoning batch ${batch.batchId} after ${config.maxAttempts} attempts; local file remains for backfill`)
        }
      }
      cursor.set(batch.file, { offset: batch.endOffset })
      await cursor.save()
    })().finally(() => { inFlight = undefined })
  }

  const timer = setInterval(() => { tick() }, config.pollIntervalMs)
  timer.unref()
  const heartbeat = setInterval(() => {
    void sender.sendHeartbeat().catch((error) => { ctx.logger.warn(`usage-exporter: heartbeat failed: ${String(error)}`) })
  }, config.heartbeatIntervalMs)
  heartbeat.unref()
  ctx.effect(() => () => clearInterval(timer), 'usage-exporter: poll timer')
  ctx.effect(() => () => clearInterval(heartbeat), 'usage-exporter: heartbeat timer')
  ctx.effect(() => async () => { await inFlight }, 'usage-exporter: drain in-flight send')
  void tick()
}

export function rootIdFor(root: string): string {
  let canonical = resolve(root)
  if (process.platform === 'win32') canonical = canonical.replaceAll('\\', '/').toLowerCase()
  return 'root:' + createHash('sha256').update(canonical, 'utf8').digest('hex')
}

function defaultSourceId(): string {
  const home = resolveDshHome()
  const digest = createHash('sha256').update(`${hostname()}\0${home}`, 'utf8').digest('hex').slice(0, 8)
  return `${hostname()}-${digest}`.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64)
}
