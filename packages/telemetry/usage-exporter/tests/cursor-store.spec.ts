import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CursorStore } from '../src/cursor-store.ts'

describe('CursorStore', () => {
  it('persists cursors atomically and reloads them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-exporter-cursor-'))
    const path = join(dir, 'cursor.json')
    const first = new CursorStore(path)
    await first.load()
    first.set('/tmp/usage-2026-08-16.jsonl', { offset: 42 })
    await first.save()

    const second = new CursorStore(path)
    await second.load()
    expect(second.get('/tmp/usage-2026-08-16.jsonl')).toEqual({ offset: 42 })
    await rm(dir, { recursive: true, force: true })
  })

  it('prunes cursors for files no longer present', async () => {
    const store = new CursorStore(join(tmpdir(), 'usage-exporter-cursor.json'))
    await store.load()
    store.set('a.jsonl', { offset: 1 })
    store.set('b.jsonl', { offset: 2 })
    store.prune(new Set(['a.jsonl']))
    expect(store.get('a.jsonl')).toEqual({ offset: 1 })
    expect(store.get('b.jsonl')).toBeUndefined()
  })
})
