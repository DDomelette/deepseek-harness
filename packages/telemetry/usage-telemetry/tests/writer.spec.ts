import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUsageWriter } from '../src/writer.ts'

const tempRoots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'usage-telemetry-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
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
})
