import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { CursorStore } from '../src/cursor-store.ts'

describe('CursorStore', () => {
  it.each([{ version: 2, files: {} }, { version: 1, files: null }, { version: 1, files: 1 }])(
    'ignores unsupported cursor documents: %j', async (document) => {
      const dir = await mkdtemp(join(tmpdir(), 'usage-exporter-invalid-cursor-'))
      onTestFinished(() => rm(dir, { recursive: true, force: true }))
      const path = join(dir, 'cursor.json')
      await writeFile(path, JSON.stringify(document))
      const store = new CursorStore(path)
      await store.load()
      await store.save()
      const reloaded = new CursorStore(path)
      await reloaded.load()
      expect(reloaded.get('good.jsonl')).toBeUndefined()
    },
  )
  it('persists cursors atomically and reloads them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-exporter-cursor-'))
    onTestFinished(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, 'cursor.json')
    const first = new CursorStore(path)
    await first.load()
    first.set('/tmp/usage-2026-08-16.jsonl', { offset: 42 })
    await first.save()

    const second = new CursorStore(path)
    await second.load()
    expect(second.get('/tmp/usage-2026-08-16.jsonl')).toEqual({ offset: 42 })
  })

  it('drops invalid cursor entries and recovers from malformed JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-exporter-cursor-'))
    onTestFinished(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, 'cursor.json')
    await writeFile(path, JSON.stringify({ version: 1, files: {
      '': { offset: 2 }, 'null.jsonl': null, 'number.jsonl': 1,
      'bad-negative.jsonl': { offset: -1 }, 'bad-float.jsonl': { offset: 1.5 }, 'good.jsonl': { offset: 3 },
    } }))
    const store = new CursorStore(path)
    await store.load()
    expect(store.get('bad-negative.jsonl')).toBeUndefined()
    expect(store.get('')).toBeUndefined()
    expect(store.get('null.jsonl')).toBeUndefined()
    expect(store.get('number.jsonl')).toBeUndefined()
    expect(store.get('bad-float.jsonl')).toBeUndefined()
    expect(store.get('good.jsonl')).toEqual({ offset: 3 })

    await writeFile(path, '{oops')
    const recovered = new CursorStore(path)
    await recovered.load()
    expect(recovered.get('good.jsonl')).toBeUndefined()
  })

  it('prunes cursors for files no longer present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-exporter-prune-'))
    onTestFinished(() => rm(dir, { recursive: true, force: true }))
    const store = new CursorStore(join(dir, 'cursor.json'))
    await store.load()
    store.set('a.jsonl', { offset: 1 })
    store.set('b.jsonl', { offset: 2 })
    store.prune(new Set(['a.jsonl']))
    expect(store.get('a.jsonl')).toEqual({ offset: 1 })
    expect(store.get('b.jsonl')).toBeUndefined()
  })
})
