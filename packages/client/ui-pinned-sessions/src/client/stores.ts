import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionPinsSnapshot } from '@deepseek-ai/dsh-session-pins/types'

export type { SessionPinsSnapshot } from '@deepseek-ai/dsh-session-pins/types'

/** Client state for the durable pin snapshot and its latest load or mutation error. */
export interface PinnedSessionsState {
  snapshot: SessionPinsSnapshot
  ready: boolean
  error: string | null
}

type PinnedSessionsActions = {
  commit: (draft: PinnedSessionsState, snapshot: SessionPinsSnapshot) => void
  optimistic: (draft: PinnedSessionsState, snapshot: SessionPinsSnapshot) => void
  rollback: (draft: PinnedSessionsState, snapshot: SessionPinsSnapshot) => void
  fail: (draft: PinnedSessionsState, error: string) => void
}

/**
 * Create the pinned-sessions store with an empty, not-yet-loaded snapshot.
 *
 * @returns Store handle exposing commit, optimistic update, rollback, and failure actions.
 */
export function createPinnedSessionsStore(): EngineStoreHandle<PinnedSessionsState, PinnedSessionsActions> {
  return defineStore({
    init: (): PinnedSessionsState => ({
      snapshot: { pinnedSessionIds: [], groupOrder: {}, flatOrder: [] },
      ready: false,
      error: null,
    }),
    actions: {
      commit: (d, snapshot) => { d.snapshot = snapshot; d.ready = true; d.error = null },
      optimistic: (d, snapshot) => { d.snapshot = snapshot; d.ready = true; d.error = null },
      rollback: (d, snapshot) => { d.snapshot = snapshot; d.error = null },
      fail: (d, error) => { d.error = error },
    },
  })
}
