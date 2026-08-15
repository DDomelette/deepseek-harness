/** Tail reader over the daily usage telemetry JSONL files. */

import { createHash } from 'node:crypto'
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { usageRowSchema, type UsageRow } from '@deepseek-ai/dsh-usage-telemetry/src/schema.ts'
import type { CursorStore } from './cursor-store.ts'

const FILE_PATTERN = /^usage-\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\.jsonl$/

export interface UsageBatch {
  sourceId: string
  batchId: string
  file: string
  rows: UsageRow[]
  startOffset: number
  endOffset: number
}

export function batchIdFor(sourceId: string, file: string, startOffset: number, endOffset: number): string {
  return 'sha256:' + createHash('sha256').update([sourceId, file, String(startOffset), String(endOffset)].join('\0'), 'utf8').digest('hex')
}

export class UsageTailReader {
  /** First poll snapshots pre-existing files at EOF; files created later start at zero. */
  private initialized = false

  constructor(private readonly options: {
    root: string
    sourceId: string
    cursorStore: CursorStore
    startFrom: 'end' | 'beginning'
    maxBatchBytes: number
    maxBatchRows: number
    logMalformed: (file: string, message: string) => void
  }) {}

  async nextBatch(): Promise<UsageBatch | undefined> {
    const { root, sourceId, cursorStore, startFrom, maxBatchBytes, maxBatchRows, logMalformed } = this.options
    const names = (await readdir(root)).filter(name => FILE_PATTERN.test(name)).sort()
    if (!this.initialized) {
      if (startFrom === 'end') {
        for (const name of names) {
          const file = join(root, name)
          const info = await stat(file)
          cursorStore.set(file, { offset: info.size })
        }
      }
      this.initialized = true
      await cursorStore.save()
    }
    if (names.length === 0) return
    const active = new Set(names.map(name => join(root, name)))
    cursorStore.prune(active)

    for (const name of names) {
      const file = join(root, name)
      const info = await stat(file)
      let cursor = cursorStore.get(file)
      if (cursor === undefined || info.size < cursor.offset) {
        // A file absent from the initial snapshot is new, and a truncated
        // file restarts from zero; both are the same cursor reset.
        cursor = { offset: 0 }
        cursorStore.set(file, cursor)
      }
      if (info.size <= cursor.offset) continue

      const handle = await open(file, 'r')
      try {
        let length = Math.min(info.size - cursor.offset, maxBatchBytes)
        const buffer = Buffer.alloc(length)
        const { bytesRead } = await handle.read(buffer, 0, length, cursor.offset)
        length = bytesRead
        let endOffset = cursor.offset + length
        if (endOffset < info.size) {
          const lastNewline = buffer.lastIndexOf(0x0a)
          if (lastNewline < 0) continue
          endOffset = cursor.offset + lastNewline + 1
        }
        const text = buffer.subarray(0, endOffset - cursor.offset).toString('utf8')
        const rows: UsageRow[] = []
        let lineOffset = cursor.offset
        const rawLines = text.split('\n')
        // A trailing newline produces one final empty element; an EOF line
        // without a newline is complete only when this read reached EOF.
        const lineCount = rawLines.at(-1) === '' ? rawLines.length - 1 : rawLines.length
        for (let index = 0; index < lineCount; index += 1) {
          const raw = rawLines[index]
          if (raw === undefined) continue
          const line = raw.trim()
          const hasNewline = index < lineCount - 1 || endOffset === info.size
          lineOffset += Buffer.byteLength(raw, 'utf8') + (hasNewline ? 1 : 0)
          if (line.length === 0) continue
          try {
            rows.push(usageRowSchema.parse(JSON.parse(line)))
          } catch (error) {
            logMalformed(file, String(error))
          }
          if (rows.length >= maxBatchRows) {
            // Never advance past the row that filled the batch: the remaining
            // bytes stay for the next batch.
            endOffset = lineOffset
            break
          }
        }
        if (rows.length > 0) {
          return {
            sourceId,
            file,
            rows,
            startOffset: cursor.offset,
            endOffset,
            batchId: batchIdFor(sourceId, file, cursor.offset, endOffset),
          }
        }
        // All read lines were blank or malformed. Advance past them without
        // sending an empty batch, then look for a later batch/file.
        cursorStore.set(file, { offset: endOffset })
        await cursorStore.save()
      } finally {
        await handle.close()
      }
    }
  }
}
