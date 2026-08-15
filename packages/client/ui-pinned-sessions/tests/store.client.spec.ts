import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { createPinnedSessionsStore } from '../src/client/stores.ts'

const sid = (id: string) => id as SessionId
const snapshot = () => ({
  pinnedSessionIds: [sid('s1')],
  groupOrder: { ws: [sid('s1')] },
  flatOrder: [sid('s1')],
})

describe('pinned sessions store', () => {
  it('commits, optimistically replaces, and rolls back snapshots', () => {
    const store = createPinnedSessionsStore().create()
    expect(store.getSnapshot().ready).toBe(false)
    store.actions.commit(snapshot())
    expect(store.getSnapshot()).toMatchObject({ ready: true, snapshot: snapshot() })
    const previous = store.getSnapshot().snapshot
    store.actions.optimistic({ ...previous, pinnedSessionIds: [] })
    expect(store.getSnapshot().snapshot.pinnedSessionIds).toEqual([])
    store.actions.rollback(previous)
    expect(store.getSnapshot().snapshot.pinnedSessionIds).toEqual([sid('s1')])
    store.actions.fail('boom')
    expect(store.getSnapshot().error).toBe('boom')
  })
})
