/**
 * Frozen v1 row schema for the usage telemetry JSONL ($DSH_HOME/telemetry/).
 * Consumers (DeepSeek Monitor) drop any row whose `v` they do not know.
 *
 * The consumer-side validation window is mirrored explicitly: `time` is an
 * integer epoch-ms timestamp (consumers reject rows outside [2000-01-01, their
 * clock + 24h]), and every numeric field must be a safe integer (consumers
 * validate with Number.isSafeInteger). Zod 4's `.int()` explicitly accepts
 * only safe integers, matching that consumer requirement.
 */

import { z } from 'zod'

/** Row schema version, frozen at 1. */
export const USAGE_ROW_VERSION = 1

/** Runtime validator for one frozen v1 usage-telemetry row. */
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

/** A validated v1 usage-telemetry row before JSONL serialization. */
export type UsageRow = z.infer<typeof usageRowSchema>

/**
 * Serialize one validated row in the frozen JSONL key order.
 * @param row - Row whose fields satisfy the v1 schema.
 * @returns One JSON object without its JSONL trailing newline.
 */
export function serializeRow(row: UsageRow): string {
  return JSON.stringify(usageRowSchema.parse(row))
}
