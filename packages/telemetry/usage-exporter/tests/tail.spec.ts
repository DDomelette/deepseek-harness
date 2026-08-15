import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CursorStore } from '../src/cursor-store.ts'
import { batchIdFor, UsageTailReader } from '../src/tail.ts'

const ROW = { v: 1, time: 1786817351458, sessionId: 's', model: 'm', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }

async function cursor(root: string): Promise<CursorStore> {
  const store = new CursorStore(join(root, 'cursor.json'))
  await store.load()
  return store
}

describe('UsageTailReader', () => {
  it('tails from EOF by default and reads only appended rows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'usage-exporter-tail-'))
    const file = join(root, 'usage-2026-08-16.jsonl')
    await writeFile(file, JSON.stringify(ROW) + '\n')
    const reader = new UsageTailReader({ root, sourceId: 'src', cursorStore: await cursor(root), startFrom: 'end', maxBatchBytes: 65536, maxBatchRows: 10, logMalformed: () => {} })

    expect(await reader.nextBatch()).toBeUndefined()

    await appendFile(file, JSON.stringify(ROW) + '\n')
    const batch = await reader.nextBatch()
    expect(batch?.rows).toHaveLength(1)
    expect(batch?.startOffset).toBe(JSON.stringify(ROW).length + 1)
    expect(batch?.batchId).toBe(batchIdFor('src', file, batch.startOffset, batch.endOffset!))
    await rm(root, { recursive: true, force: true })
  })

  it('skips a malformed line and advances past it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'usage-exporter-tail-'))
    const file = join(root, 'usage-2026-08-16.jsonl')
    await writeFile(file, '{bad\n' + JSON.stringify(ROW) + '\n')
    const malformed: string[] = []
    const reader = new UsageTailReader({ root, sourceId: 'src', cursorStore: await cursor(root), startFrom: 'beginning', maxBatchBytes: 65536, maxBatchRows: 10, logMalformed: (_file, message) => { malformed.push(message) } })

    const batch = await reader.nextBatch()

    expect(batch?.rows).toHaveLength(1)
    expect(malformed).toHaveLength(1)
    await rm(root, { recursive: true, force: true })
  })
})
