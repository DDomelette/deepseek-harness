/**
 * Append-only writer for the usage telemetry JSONL. The file name carries the
 * local date, so rotation is a pure function of `now()`: each write recomputes
 * the target path and appendFile reopens it (no cached fd to reset). A first
 * write into a missing directory retries once after mkdir -p (ENOENT self-heal).
 * Callers own failure policy; every error propagates to the caller.
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface UsageWriterOptions {
  /** Absolute telemetry root (usually $DSH_HOME/telemetry). */
  root: string
  /** Injectable clock; defaults to the wall clock. */
  now?: () => Date
}

export interface UsageWriter {
  /** Append one line (trailing newline added). Rejects on unrecoverable errors. */
  write(line: string): Promise<void>
}

export function createUsageWriter(options: UsageWriterOptions): UsageWriter {
  const now = options.now ?? (() => new Date())

  function dayStamp(): string {
    const d = now()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${month}-${day}`
  }

  function fileFor(): string {
    return join(options.root, `usage-${dayStamp()}.jsonl`)
  }

  return {
    async write(line: string): Promise<void> {
      const file = fileFor()
      try {
        await appendFile(file, line + '\n', 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        await mkdir(options.root, { recursive: true })
        await appendFile(file, line + '\n', 'utf8')
      }
    },
  }
}
