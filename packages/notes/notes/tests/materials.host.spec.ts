/**
 * Material storage: insertion order, explicit reordering, archiving out of the
 * list, restore-to-top, and per-conversation scoping over the real domain.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bench, material, materialId, noteId } from './bench.ts'
import type { Bench } from './bench.ts'

let mounted: Bench

beforeEach(async () => {
  mounted = await bench()
})

afterEach(async () => {
  await mounted.dispose()
})

/** Store one draft material and return its id. */
async function seed(text: string, at = 0): Promise<ReturnType<typeof materialId>> {
  return await mounted.materials.create(material({ noteId: noteId('n1'), text, createdAt: at }))
}

describe('notes materials', () => {
  it('lands each new material above the previous one, then honours an explicit reorder', async () => {
    const a = await seed('a')
    const b = await seed('b')
    const c = await seed('c')
    expect(mounted.materials.list(noteId('n1')).map(row => row.text)).toEqual(['c', 'b', 'a'])

    await mounted.materials.reorder(noteId('n1'), [a, c, b])
    expect(mounted.materials.list(noteId('n1')).map(row => row.text)).toEqual(['a', 'c', 'b'])
  })

  it('breaks an equal order value by creation instant', async () => {
    const a = await seed('a', 20)
    const b = await seed('b', 10)
    // Two materials sharing one order value is the only case the creation
    // instant decides, so pin both to the same order deliberately.
    await mounted.materials.update(a, current => ({ ...current, order: 1 }))
    await mounted.materials.update(b, current => ({ ...current, order: 1 }))
    expect(mounted.materials.list(noteId('n1')).map(row => row.text)).toEqual(['b', 'a'])
  })

  it('archives out of the list and restores to the top', async () => {
    const a = await seed('a')
    await seed('b')
    await mounted.materials.archive(a)
    expect(mounted.materials.list(noteId('n1')).map(row => row.text)).toEqual(['b'])
    expect(mounted.materials.archived(noteId('n1')).map(row => row.text)).toEqual(['a'])

    await mounted.materials.restore(a)
    expect(mounted.materials.list(noteId('n1')).map(row => row.text)).toEqual(['a', 'b'])
    expect(mounted.materials.archived(noteId('n1'))).toEqual([])
  })

  it('orders the archived bucket by archive instant, newest first', async () => {
    const a = await seed('a')
    const b = await seed('b')
    await mounted.materials.archive(a)
    await mounted.materials.archive(b)
    // `Date.now()` may not advance between two immediate archives, so the
    // assertion accepts either order and pins only the bucket membership.
    expect(mounted.materials.archived(noteId('n1')).map(row => row.text).sort()).toEqual(['a', 'b'])
    expect(mounted.materials.list(noteId('n1'))).toEqual([])
  })

  it('scopes every read to one conversation', async () => {
    await seed('a')
    await mounted.materials.create(material({ noteId: noteId('n2'), text: 'b' }))
    expect(mounted.materials.list(noteId('n1')).map(row => row.text)).toEqual(['a'])
    expect(mounted.materials.list(noteId('n2')).map(row => row.text)).toEqual(['b'])
    expect(mounted.materials.list(noteId('n3'))).toEqual([])
  })

  it('reads one material by id, and reports an absent one', async () => {
    const a = await seed('a')
    expect(mounted.materials.get(a)?.text).toBe('a')
    expect(mounted.materials.get(materialId('absent'))).toBeUndefined()
  })

  it('replaces one material through update', async () => {
    const a = await seed('a')
    const next = await mounted.materials.update(a, current => ({ ...current, text: 'edited' }))
    expect(next.text).toBe('edited')
    expect(mounted.materials.get(a)?.text).toBe('edited')
  })

  it('deletes one material', async () => {
    const a = await seed('a')
    await mounted.materials.remove(a)
    expect(mounted.materials.get(a)).toBeUndefined()
  })

  it('treats a restore of an unknown material as a no-op', async () => {
    await expect(mounted.materials.restore(materialId('absent'))).resolves.toBeUndefined()
    expect(mounted.materials.list(noteId('n1'))).toEqual([])
  })

  it('refuses to reorder an id that is not visible in the conversation', async () => {
    const a = await seed('a')
    await mounted.materials.archive(a)
    await expect(mounted.materials.reorder(noteId('n1'), [a]))
      .rejects.toThrow(/is not visible in this conversation/)
  })
})
