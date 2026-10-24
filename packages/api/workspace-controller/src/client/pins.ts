/**
 * Client-side owner of the ordered pin snapshot that `session-pins` serves.
 * The Host owns the pin set and both saved orders; this model keeps one
 * detached copy, installs current committed mutation echoes, and re-reads on
 * demand so a write made through another Remote namespace becomes visible.
 * @module @deepseek-ai/dsh-api-workspace-controller/src/client/pins
 */

import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-session-pins/remote'
import type { SessionPinsSnapshot } from '@deepseek-ai/dsh-session-pins/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult, TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'

/** Complete generated `ctx.remote.sessionPins` namespace. */
export type SessionPinsRemote = TypertClientRemote['sessionPins']

/** Bare observable source for the ordered pin snapshot. */
export interface SessionPinsSource {
  /** Read the identity-stable current snapshot. */
  getSnapshot(): SessionPinsSnapshot
  /**
   * Subscribe to snapshot changes.
   * @param listener - invalidation callback.
   * @returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void
}

/** The pin state before the first read lands: no pins and no saved order. */
const EMPTY_SNAPSHOT: SessionPinsSnapshot = { pinnedSessionIds: [], groupOrder: {}, flatOrder: [] }

const sameOrder = (left: readonly SessionId[], right: readonly SessionId[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

const sameGroupOrder = (
  left: SessionPinsSnapshot['groupOrder'],
  right: SessionPinsSnapshot['groupOrder'],
): boolean => {
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => {
    const other = right[key]
    return other !== undefined && sameOrder(left[key] ?? [], other)
  })
}

const sameSnapshot = (left: SessionPinsSnapshot, right: SessionPinsSnapshot): boolean =>
  sameOrder(left.pinnedSessionIds, right.pinnedSessionIds)
  && sameOrder(left.flatOrder, right.flatOrder)
  && sameGroupOrder(left.groupOrder, right.groupOrder)

/**
 * Owns the Client ordered-pin projection. Mutations install committed snapshots
 * unless a newer mutation or successful refresh supersedes them; `reload()`
 * reads state another namespace changed. Failed writes never change the snapshot.
 */
export class ClientSessionPinsModel implements SessionPinsSource {
  private snapshot: SessionPinsSnapshot = EMPTY_SNAPSHOT
  private readonly listeners = new Set<() => void>()
  /** Latest read request; only its reply may install a snapshot. */
  private readSeq = 0
  /** A later mutation or successful current read outranks an older echo. */
  private mutationSeq = 0

  /** @param remote - generated `sessionPins` Remote namespace. */
  constructor(private readonly remote: SessionPinsRemote) {}

  /**
   * Re-read the owner's complete snapshot.
   *
   * A failed read keeps the last committed snapshot and is logged: the pin set
   * is display state, and a transient carrier fault must not empty the sidebar
   * or reject an unrelated navigation. A successful current read supersedes
   * pending mutation responses; a failed read leaves them eligible to install.
   * @returns resolution after the read settles.
   */
  async reload(): Promise<void> {
    const readSeq = ++this.readSeq
    const result = await this.remote.list()
    if (readSeq !== this.readSeq) return
    if (!result.ok) {
      console.warn('pinned session reload failed:', result.error.message)
      return
    }
    this.mutationSeq++
    this.install(result.value)
  }

  /**
   * Persist the complete pinned display order and install the committed result.
   * @param orderedIds - every pinned Session id, in display order.
   * @returns the generated Remote result, also on failure.
   */
  async reorderFlat(orderedIds: readonly SessionId[]): Promise<RemoteResult<SessionPinsSnapshot>> {
    const mutationSeq = ++this.mutationSeq
    this.readSeq++
    const result = await this.remote.reorderFlat({ orderedIds: [...orderedIds] })
    if (result.ok && mutationSeq === this.mutationSeq) this.install(result.value)
    return result
  }

  /**
   * Subscribe to pin-snapshot invalidation.
   * @param listener - invalidation callback.
   * @returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Read the current snapshot.
   * @returns the last committed snapshot, which keeps its identity until a read or echo changes it.
   */
  getSnapshot(): SessionPinsSnapshot {
    return this.snapshot
  }

  private install(next: SessionPinsSnapshot): void {
    if (sameSnapshot(this.snapshot, next)) return
    this.snapshot = {
      pinnedSessionIds: [...next.pinnedSessionIds],
      groupOrder: Object.fromEntries(
        Object.entries(next.groupOrder).map(([key, ids]) => [key, [...ids]]),
      ),
      flatOrder: [...next.flatOrder],
    }
    notifySubscribers(this.listeners, '[workspace-controller.pins]')
  }
}
