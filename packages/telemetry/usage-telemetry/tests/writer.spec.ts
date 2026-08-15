import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const appendState = vi.hoisted(() => ({
  holdFirstAppend: false,
  firstAppendStarted: undefined as (() => void) | undefined,
  continueFirstAppend: undefined as Promise<void> | undefined,
  startedLines: [] as string[],
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    appendFile: async (...args: Parameters<typeof actual.appendFile>) => {
      const line = args[1]
      if (typeof line !== 'string') throw new TypeError('usage writer must append text')
      appendState.startedLines.push(line)
      if (appendState.holdFirstAppend) {
        appendState.holdFirstAppend = false
        appendState.firstAppendStarted!()
        await appendState.continueFirstAppend!
      }
      return Reflect.apply(actual.appendFile, actual, args)
    },
  }
})

import { createUsageWriter } from '../src/writer.ts'

const tempRoots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'usage-telemetry-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  appendState.holdFirstAppend = false
  appendState.firstAppendStarted = undefined
  appendState.continueFirstAppend = undefined
  appendState.startedLines = []
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('usage writer', () => {
  it('creates the directory and appends lines to usage-YYYY-MM-DD.jsonl', async () => {
    const root = join(await tempRoot(), 'telemetry')
    const writer = createUsageWriter({ root, now: () => new Date(2026, 7, 14, 12, 0, 0) })
    await writer.write('{"v":1}')
    await writer.write('{"v":1}')
    const files = await readdir(root)
    expect(files).toEqual(['usage-2026-08-14.jsonl'])
    const content = await readFile(join(root, 'usage-2026-08-14.jsonl'), 'utf8')
    expect(content).toBe('{"v":1}\n{"v":1}\n')
  })

  it('rotates to a new file when the local day changes', async () => {
    const root = join(await tempRoot(), 'telemetry')
    let day = 14
    const writer = createUsageWriter({ root, now: () => new Date(2026, 7, day, 23, 59, 0) })
    await writer.write('{"day":14}')
    day = 15
    await writer.write('{"day":15}')
    const files = await readdir(root)
    expect(files.sort()).toEqual(['usage-2026-08-14.jsonl', 'usage-2026-08-15.jsonl'])
    expect(await readFile(join(root, 'usage-2026-08-15.jsonl'), 'utf8')).toBe('{"day":15}\n')
  })

  it('self-heals a missing directory (ENOENT) on the first write', async () => {
    const base = await tempRoot()
    const root = join(base, 'deep', 'telemetry')
    const writer = createUsageWriter({ root, now: () => new Date(2026, 7, 14) })
    await writer.write('{"v":1}')
    const content = await readFile(join(root, 'usage-2026-08-14.jsonl'), 'utf8')
    expect(content).toBe('{"v":1}\n')
  })

  it('rejects a write when the parent path is not a directory (caller contains)', async () => {
    const root = await tempRoot()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(root, 'usage-2026-08-14.jsonl'), 'blocker')
    const blockerDir = root
    // Root itself is fine; make root's parent a file via a child path trick:
    // point the writer at <root>/file-child/telemetry where file-child is a file.
    await writeFile(join(blockerDir, 'file-child'), 'x')
    const bad = createUsageWriter({ root: join(blockerDir, 'file-child', 'telemetry'), now: () => new Date(2026, 7, 14) })
    await expect(bad.write('{"v":1}')).rejects.toThrow()
  })

  it('queues a later append and retains its invocation-day destination', async () => {
    const root = join(await tempRoot(), 'telemetry')
    await mkdir(root, { recursive: true })
    let day = 14
    const writer = createUsageWriter({ root, now: () => new Date(2026, 7, day) })
    let markFirstAppendStarted!: () => void
    const firstAppendStarted = new Promise<void>((resolve) => { markFirstAppendStarted = resolve })
    let releaseFirstAppend!: () => void
    appendState.holdFirstAppend = true
    appendState.firstAppendStarted = markFirstAppendStarted
    appendState.continueFirstAppend = new Promise<void>((resolve) => { releaseFirstAppend = resolve })

    const first = writer.write('{"sequence":1}')
    await firstAppendStarted
    day = 15
    const second = writer.write('{"sequence":2}')
    day = 16

    try {
      await vi.waitFor(() => { expect(appendState.startedLines).toEqual(['{"sequence":1}\n']) })
    } finally {
      releaseFirstAppend()
    }
    await Promise.all([first, second])

    expect(await readFile(join(root, 'usage-2026-08-14.jsonl'), 'utf8')).toBe('{"sequence":1}\n')
    expect(await readFile(join(root, 'usage-2026-08-15.jsonl'), 'utf8')).toBe('{"sequence":2}\n')
    await expect(readFile(join(root, 'usage-2026-08-16.jsonl'), 'utf8')).rejects.toThrow()
  })

  it('runs a later write after its predecessor fails', async () => {
    const root = join(await tempRoot(), 'telemetry')
    const file = join(root, 'usage-2026-08-14.jsonl')
    const { mkdir, rm } = await import('node:fs/promises')
    await mkdir(file, { recursive: true })
    const writer = createUsageWriter({ root, now: () => new Date(2026, 7, 14) })

    await expect(writer.write('{"sequence":1}')).rejects.toThrow()
    await rm(file, { recursive: true })
    await writer.write('{"sequence":2}')

    expect(await readFile(file, 'utf8')).toBe('{"sequence":2}\n')
  })

  it('follows a clock rollback into the earlier-day file without touching the later one', async () => {
    const root = join(await tempRoot(), 'telemetry')
    let day = 14
    const writer = createUsageWriter({ root, now: () => new Date(2026, 7, day, 12, 0, 0) })
    await writer.write('{"day":14}')
    day = 13
    await writer.write('{"day":13}')
    const files = await readdir(root)
    expect(files.sort()).toEqual(['usage-2026-08-13.jsonl', 'usage-2026-08-14.jsonl'])
    expect(await readFile(join(root, 'usage-2026-08-14.jsonl'), 'utf8')).toBe('{"day":14}\n')
    expect(await readFile(join(root, 'usage-2026-08-13.jsonl'), 'utf8')).toBe('{"day":13}\n')
  })

  it('crosses midnight exactly: 23:59:59.999 stays in the old file, 00:00:00.000 starts the new one', async () => {
    const root = join(await tempRoot(), 'telemetry')
    let time = new Date(2026, 7, 14, 23, 59, 59, 999)
    const writer = createUsageWriter({ root, now: () => time })
    await writer.write('{"day":14}')
    time = new Date(2026, 7, 15, 0, 0, 0, 0)
    await writer.write('{"day":15}')
    expect(await readFile(join(root, 'usage-2026-08-14.jsonl'), 'utf8')).toBe('{"day":14}\n')
    expect(await readFile(join(root, 'usage-2026-08-15.jsonl'), 'utf8')).toBe('{"day":15}\n')
  })

  it('pads single-digit months and days in the file name (consumer MATCH compatibility)', async () => {
    const root = join(await tempRoot(), 'telemetry')
    const writer = createUsageWriter({ root, now: () => new Date(2026, 10, 5, 12, 0, 0) })
    await writer.write('{"v":1}')
    expect(await readdir(root)).toEqual(['usage-2026-11-05.jsonl'])
  })
})
