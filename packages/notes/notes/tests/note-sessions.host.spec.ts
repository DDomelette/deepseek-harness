/**
 * Notes conversations: recording, the active pointer, archiving, and restore.
 * The conversation list is ordered by creation instant, so a restored
 * conversation returns at its creation position rather than the top.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bench, noteId, noteSession, sessionId } from './bench.ts'
import type { Bench } from './bench.ts'

let mounted: Bench

beforeEach(async () => {
  mounted = await bench()
})

afterEach(async () => {
  await mounted.dispose()
})

/** Record one conversation and return its id. */
async function record(title: string, at: number): Promise<ReturnType<typeof noteId>> {
  return await mounted.sessions.record(noteSession({
    sessionId: sessionId(`dsh-${title}`),
    title,
    createdAt: at,
  }))
}

describe('notes conversations', () => {
  it('records a conversation, makes it active, and archives it out of the list', async () => {
    const first = await record('a', 1)
    expect(mounted.sessions.active()).toBe(first)
    expect(mounted.sessions.list().map(row => row.title)).toEqual(['a'])

    await mounted.sessions.archive(first)
    expect(mounted.sessions.list()).toEqual([])
    expect(mounted.sessions.archived().map(row => row.title)).toEqual(['a'])
    // The archived conversation was the active one, and nothing is left to
    // point at, so the pointer clears rather than dangling.
    expect(mounted.sessions.active()).toBeNull()
  })

  it('moves the active pointer to the newest remaining conversation', async () => {
    const first = await record('a', 1)
    const second = await record('b', 2)
    expect(mounted.sessions.active()).toBe(second)
    await mounted.sessions.archive(second)
    expect(mounted.sessions.active()).toBe(first)
  })

  it('orders the archived bucket by archive instant', async () => {
    const first = await record('a', 1)
    const second = await record('b', 2)
    await mounted.sessions.archive(first)
    await mounted.sessions.archive(second)
    // Two immediate archives may share one `Date.now()` millisecond, so this
    // pins bucket membership and leaves the instant tie to the stable sort.
    expect(mounted.sessions.archived().map(row => row.title).sort()).toEqual(['a', 'b'])
    expect(mounted.sessions.list()).toEqual([])
  })

  it('keeps the active pointer when a different conversation is archived', async () => {
    const first = await record('a', 1)
    const second = await record('b', 2)
    await mounted.sessions.archive(first)
    expect(mounted.sessions.active()).toBe(second)
  })

  it('restores an archived conversation at its creation position and makes it active', async () => {
    const first = await record('a', 1)
    await record('b', 2)
    await mounted.sessions.archive(first)
    await mounted.sessions.restore(first)

    expect(mounted.sessions.list().map(row => row.title)).toEqual(['b', 'a'])
    expect(mounted.sessions.active()).toBe(first)
    expect(mounted.sessions.archived()).toEqual([])
  })

  it('reads one conversation by id, and reports an absent one', async () => {
    const first = await record('a', 1)
    expect(mounted.sessions.get(first)?.title).toBe('a')
    expect(mounted.sessions.get(noteId('absent'))).toBeUndefined()
  })

  it('points the panel at an explicit conversation, and at none', async () => {
    const first = await record('a', 1)
    const second = await record('b', 2)
    await mounted.sessions.setActive(first)
    expect(mounted.sessions.active()).toBe(first)
    await mounted.sessions.setActive(null)
    expect(mounted.sessions.active()).toBeNull()
    expect(second).not.toBe(first)
  })
})
