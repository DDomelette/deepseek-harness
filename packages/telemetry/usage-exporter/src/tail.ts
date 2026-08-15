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
    if (names.length === 0) return
    const active = new Set(names.map(name => join(root, name)))
    cursorStore.prune(active)

    for (const name of names) {
      const file = join(root, name)
      const info = await stat(file)
      let cursor = cursorStore.get(file)
      if (cursor === undefined) {
        cursor = { offset: startFrom === 'end' ? info.size : 0 }
        cursorStore.set(file, cursor)
      } else if (info.size < cursor.offset) {
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
        for (const raw of text.split('\n')) {
          const line = raw.trim()
          if (line.length === 0) continue
          try {
            rows.push(usageRowSchema.parse(JSON.parse(line)))
          } catch (error) {
            logMalformed(file, String(error))
          }
          if (rows.length >= maxBatchRows) break
        }
        return {
          sourceId,
          file,
          rows,
          startOffset: cursor.offset,
          endOffset,
          batchId: batchIdFor(sourceId, file, cursor.offset, endOffset),
        }
      } finally {
        await handle.close()
      }
    }
  }
}
