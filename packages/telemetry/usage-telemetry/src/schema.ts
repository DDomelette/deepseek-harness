/**
 * Frozen v1 row schema for the usage telemetry JSONL ($DSH_HOME/telemetry/).
 * Consumers (DeepSeek Monitor) drop any row whose `v` they do not know.
 */

import { z } from 'zod'

/** Row schema version, frozen at 1. */
export const USAGE_ROW_VERSION = 1

export const usageRowSchema = z.object({
  v: z.literal(1),
  time: z.number().int().nonnegative(),
  sessionId: z.string().min(1),
  cwd: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
}).strict()

export type UsageRow = z.infer<typeof usageRowSchema>

/** Serialize one row; JSON.stringify preserves insertion order (the frozen key order). */
export function serializeRow(row: UsageRow): string {
  return JSON.stringify(usageRowSchema.parse(row))
}
