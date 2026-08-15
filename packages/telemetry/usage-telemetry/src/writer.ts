/**
 * Append-only writer for the usage telemetry JSONL. The file name carries the
 * local date, so rotation is a pure function of `now()`: each write recomputes
 * the target path and appendFile reopens it (no cached fd to reset). A first
 * write into a missing directory retries once after mkdir -p (ENOENT self-heal).
 * Callers own failure policy; every error propagates to the caller.
 *
 * Known edge cases (by design):
 * - The file name uses the machine-local date; the consumer (DeepSeek Monitor)
 *   buckets rows by Beijing time from each row's `time`, so on non-UTC+8 hosts
 *   the file-name date and the aggregation day can differ by one day. The file
 *   name is only a container; each row is read exactly once via offset cursor.
 * - Single-instance writes are assumed. Concurrent appends from multiple DSH
 *   processes are not guaranteed to be line-atomic on Windows (each write
 *   reopens the file with append); interleaved writes can corrupt one JSONL
 *   line, which consumers drop as malformed.
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Construction options for one same-process JSONL append queue. */
export interface UsageWriterOptions {
  /** Absolute telemetry root (usually $DSH_HOME/telemetry). */
  root: string
  /** Injectable clock; defaults to the wall clock. */
  now?: () => Date
}

/** Appends serialized v1 rows to the daily local usage file. */
export interface UsageWriter {
  /** Append one line (trailing newline added). Rejects on unrecoverable errors. */
  write(line: string): Promise<void>
}

/**
 * Create an ordered, same-process writer for daily usage JSONL files.
 * @param options - Root directory and optional clock for file selection.
 * @returns A writer whose failed append does not prevent later appends.
 */
export function createUsageWriter(options: UsageWriterOptions): UsageWriter {
  const now = options.now ?? (() => new Date())
  let tail: Promise<void> = Promise.resolve()

  function dayStamp(): string {
    const d = now()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${month}-${day}`
  }

  function fileFor(): string {
    return join(options.root, `usage-${dayStamp()}.jsonl`)
  }

  async function appendLine(file: string, line: string): Promise<void> {
    try {
      await appendFile(file, line + '\n', 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await mkdir(options.root, { recursive: true })
      await appendFile(file, line + '\n', 'utf8')
    }
  }

  return {
    write(line: string): Promise<void> {
      const file = fileFor()
      const current = tail.catch(() => undefined).then(() => appendLine(file, line))
      tail = current
      return current
    },
  }
}
