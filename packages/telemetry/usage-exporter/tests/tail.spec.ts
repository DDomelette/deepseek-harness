import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { CursorStore } from '../src/cursor-store.ts'
import { batchIdFor, UsageTailReader } from '../src/tail.ts'

const ROW = { v: 1, time: 1786817351458, sessionId: 's', model: 'm', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }

async function cursor(root: string): Promise<CursorStore> {
  const store = new CursorStore(join(root, 'cursor.json'))
  await store.load()
  return store
}

describe('UsageTailReader', () => {
  it.each([
    { bounded: false, trailing: false }, { bounded: false, trailing: true },
    { bounded: true, trailing: false }, { bounded: true, trailing: true },
  ])('counts existing delimiters at the row limit (byte bound: $bounded, final newline: $trailing)', async ({ bounded, trailing }) => {
    const root = await mkdtemp(join(tmpdir(), 'usage-exporter-tail-offset-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const file = join(root, 'usage-2026-08-16.jsonl')
    const line = JSON.stringify(ROW)
    const original = (bounded ? `${line}\n${line}` : line) + (trailing ? '\n' : '')
    await writeFile(file, original)
    const store = await cursor(root)
    const reader = new UsageTailReader({
      root, sourceId: 'src', cursorStore: store, startFrom: 'beginning',
      maxBatchBytes: bounded ? Buffer.byteLength(line) + 4 : 65536,
      maxBatchRows: 1, logMalformed: () => {},
    })
    const first = await reader.nextBatch()
    expect(first?.rows).toEqual([ROW])
    expect(first?.endOffset).toBe(Buffer.byteLength(line) + (bounded || trailing ? 1 : 0))
    store.set(file, { offset: first!.endOffset })
    const next = await reader.nextBatch()
    if (bounded) {
      expect(next?.startOffset).toBe(first!.endOffset)
      expect(next?.rows).toEqual([ROW])
      store.set(file, { offset: next!.endOffset })
    } else expect(next).toBeUndefined()
    const appended = { ...ROW, time: ROW.time + 1 }
    const suffix = (trailing ? '' : '\n') + JSON.stringify(appended) + '\n'
    await appendFile(file, suffix)
    const last = await reader.nextBatch()
    expect(last?.rows).toEqual([appended])
    expect(last?.endOffset).toBe(Buffer.byteLength(original + suffix))
    store.set(file, { offset: last!.endOffset })
    expect(await reader.nextBatch()).toBeUndefined()
  })

  it('leaves a byte window without a complete line pending, then reads after a larger window', async () => {
    const root = await mkdtemp(join(tmpdir(), 'usage-exporter-tail-window-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const file = join(root, 'usage-2026-08-16.jsonl')
    await writeFile(file, JSON.stringify(ROW) + '\n')
    const store = await cursor(root)
    const options = { root, sourceId: 'src', cursorStore: store, startFrom: 'beginning' as const, maxBatchRows: 10, logMalformed: () => {} }
    expect(await new UsageTailReader({ ...options, maxBatchBytes: 4 }).nextBatch()).toBeUndefined()
    expect(store.get(file)).toEqual({ offset: 0 })
    expect((await new UsageTailReader({ ...options, maxBatchBytes: 65536 }).nextBatch())?.rows).toEqual([ROW])
  })

  it('persists blank and malformed ranges before looking for the next daily file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'usage-exporter-tail-malformed-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const file = join(root, 'usage-2026-08-16.jsonl')
    const malformed = '\n   \n{bad\n'
    await writeFile(file, malformed)
    await writeFile(join(root, 'usage-2026-08-17.jsonl'), JSON.stringify(ROW) + '\n')
    const store = await cursor(root)
    const messages: string[] = []
    const reader = new UsageTailReader({
      root, sourceId: 'src', cursorStore: store, startFrom: 'beginning', maxBatchBytes: 65536, maxBatchRows: 10,
      logMalformed: (_file, message) => { messages.push(message) },
    })
    expect((await reader.nextBatch())?.rows).toEqual([ROW])
    const reloaded = await cursor(root)
    expect(reloaded.get(file)).toEqual({ offset: Buffer.byteLength(malformed) })
    expect(messages).toHaveLength(1)
  })

  it('tails from EOF by default and reads only appended rows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'usage-exporter-tail-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const file = join(root, 'usage-2026-08-16.jsonl')
    await writeFile(file, JSON.stringify(ROW) + '\n')
    const reader = new UsageTailReader({ root, sourceId: 'src', cursorStore: await cursor(root), startFrom: 'end', maxBatchBytes: 65536, maxBatchRows: 10, logMalformed: () => {} })

    expect(await reader.nextBatch()).toBeUndefined()

    await appendFile(file, JSON.stringify(ROW) + '\n')
    const batch = await reader.nextBatch()
    expect(batch).toBeDefined()
    if (batch === undefined) throw new Error('expected a batch')
    expect(batch.rows).toHaveLength(1)
    expect(batch.startOffset).toBe(JSON.stringify(ROW).length + 1)
    expect(batch.batchId).toBe(batchIdFor('src', file, batch.startOffset, batch.endOffset))
  })

  it('does not advance past the row that fills maxBatchRows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'usage-exporter-tail-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const file = join(root, 'usage-2026-08-16.jsonl')
    await writeFile(file, [ROW, ROW, ROW].map(row => JSON.stringify(row)).join('\n') + '\n')
    const store = await cursor(root)
    const reader = new UsageTailReader({ root, sourceId: 'src', cursorStore: store, startFrom: 'beginning', maxBatchBytes: 65536, maxBatchRows: 1, logMalformed: () => {} })

    const first = await reader.nextBatch()
    expect(first).toBeDefined()
    if (first === undefined) throw new Error('expected the first batch')
    expect(first.rows).toHaveLength(1)
    expect(first.endOffset).toBe(first.startOffset + JSON.stringify(ROW).length + 1)
    store.set(file, { offset: first.endOffset })
    await store.save()

    const second = await reader.nextBatch()
    expect(second).toBeDefined()
    if (second === undefined) throw new Error('expected the second batch')
    expect(second.rows).toHaveLength(1)
    expect(second.startOffset).toBe(first.endOffset)

  })

  it('skips a malformed line and advances past it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'usage-exporter-tail-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const file = join(root, 'usage-2026-08-16.jsonl')
    await writeFile(file, '{bad\n' + JSON.stringify(ROW) + '\n')
    const malformed: string[] = []
    const reader = new UsageTailReader({ root, sourceId: 'src', cursorStore: await cursor(root), startFrom: 'beginning', maxBatchBytes: 65536, maxBatchRows: 10, logMalformed: (_file, message) => { malformed.push(message) } })

    const batch = await reader.nextBatch()

    expect(batch?.rows).toHaveLength(1)
    expect(malformed).toHaveLength(1)
  })
})
