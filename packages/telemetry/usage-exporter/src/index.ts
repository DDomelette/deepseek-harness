/**
 * Usage exporter: tails the local usage telemetry JSONL and pushes batches.
 * @module @deepseek-ai/dsh-usage-exporter
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export const name = 'usage-exporter'

/** Configuration for one usage ingestion endpoint. */
export interface Config {
  /** Absolute ingestion URL; HTTPS unless loopback. */
  endpoint: string
  /** Bearer token sent to the endpoint; secret-role, never logged. */
  token: string
  /** Stable source id; empty resolves to hostname plus a short DSH-home hash. */
  sourceId: string
  /** Telemetry root; default `$DSH_HOME/telemetry`. */
  telemetryRoot?: string
  /** Cursor file path; default `$DSH_HOME/storages/usage-exporter.json`. */
  cursorPath?: string
  /** Milliseconds between tail polls. */
  pollIntervalMs: number
  /** Maximum rows per pushed batch. */
  maxBatchRows: number
  /** Maximum bytes read per batch before the newline boundary. */
  maxBatchBytes: number
  /** Per-request timeout in milliseconds. */
  requestTimeoutMs: number
  /** Retries for one transient batch before abandoning it. */
  maxAttempts: number
  /** Exponential backoff base in milliseconds. */
  baseRetryMs: number
  /** Exponential backoff ceiling in milliseconds. */
  maxRetryMs: number
  /** Lease heartbeat interval in milliseconds. */
  heartbeatIntervalMs: number
  /** `end` tails the current EOF on first enable; `beginning` backfills history. */
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

import { runExporter } from './apply.ts'

export async function apply(ctx: Context, config: Config): Promise<void> {
  await runExporter(ctx, config)
}
