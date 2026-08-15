/**
 * Usage exporter: tails the local usage telemetry JSONL and pushes batches.
 * @module @deepseek-ai/dsh-usage-exporter
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export const name = 'usage-exporter'

/** Configuration for one usage ingestion endpoint. */
export interface Config {
  endpoint: string
  token: string
  sourceId: string
  telemetryRoot?: string
  cursorPath?: string
  pollIntervalMs: number
  maxBatchRows: number
  maxBatchBytes: number
  requestTimeoutMs: number
  maxAttempts: number
  baseRetryMs: number
  maxRetryMs: number
  heartbeatIntervalMs: number
  startFrom: 'end' | 'beginning'
}

export const Config: z<Config> = z.object({
  endpoint: z.string().required(),
  token: z.string().default('').role('secret'),
  sourceId: z.string().default(''),
  telemetryRoot: z.string(),
  cursorPath: z.string(),
  pollIntervalMs: z.number().min(250).max(60_000).default(1000),
  maxBatchRows: z.number().step(1).min(1).max(1000).default(200),
  maxBatchBytes: z.number().step(1).min(1024).max(1024 * 1024).default(262_144),
  requestTimeoutMs: z.number().step(1).min(500).max(120_000).default(10_000),
  maxAttempts: z.number().step(1).min(1).max(20).default(5),
  baseRetryMs: z.number().step(1).min(100).max(60_000).default(1000),
  maxRetryMs: z.number().step(1).min(100).max(300_000).default(30_000),
  heartbeatIntervalMs: z.number().step(1).min(5_000).max(300_000).default(60_000),
  startFrom: z.union([z.const('end'), z.const('beginning')]).default('end'),
})

/** Replaced by the apply-loop task. */
export async function apply(_ctx: Context, _config: Config): Promise<void> {
  throw new Error('usage-exporter: apply not implemented yet')
}
