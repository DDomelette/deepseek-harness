import { Context, Service } from '@deepseek-ai/cordis'
import type { Domain, DomainGlobal } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-flags'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { sessionPinsDomainSpec, type SessionPinsDomainState } from './spec.ts'
import type { SessionPinsSnapshot } from './types.ts'

export type * from './types.ts'
export { sessionPinsDomainSpec } from './spec.ts'

/** Duplicated or unknown ids in a reorder request. */
export class SessionPinsInvalidError extends Error {
  constructor(readonly sessionIds: readonly SessionId[]) {
    super(`session-pins-invalid: ${sessionIds.join(', ')}`)
    this.name = 'SessionPinsInvalidError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionPins: SessionPinsService
  }
}

const cloneOrder = (order: Readonly<Record<string, readonly SessionId[]>>): Record<string, SessionId[]> =>
  Object.fromEntries(Object.entries(order).map(([key, ids]) => [key, [...ids]]))

/**
 * Reconcile the flat order with the pin set it describes.
 *
 * The flat order is the complete flat-view order, so it must stay a
 * permutation of the pin set: an unpinned id leaves it, and a pinned id no
 * manual order has reached yet joins at the end, in pin order — the position a
 * flat view gives a Session outside its override.
 *
 * @param order - persisted flat order.
 * @param pinned - the pin set after this mutation.
 * @returns the reconciled order.
 */
const reconcileFlatOrder = (order: readonly SessionId[], pinned: ReadonlySet<SessionId>): SessionId[] => {
  const next = order.filter(id => pinned.has(id))
  for (const id of pinned) if (!next.includes(id)) next.push(id)
  return next
}

const snapshotOf = (state: SessionPinsDomainState): SessionPinsSnapshot => ({
  pinnedSessionIds: [...state.pinnedSessionIds],
  groupOrder: Object.fromEntries(Object.entries(state.groupOrder).map(([key, ids]) => [key, [...ids]])),
  flatOrder: [...state.flatOrder],
})

/** Durable pin set plus its Typert Remote. */
export class SessionPinsService extends TypertRemoteService {
  static inject = ['storageDomain', 'sessionFlags']

  private global: DomainGlobal<SessionPinsDomainState> | undefined
  private operationTail: Promise<void> = Promise.resolve()

  constructor(ctx: Context) {
    super(ctx, 'sessionPins')
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationTail.then(operation, operation)
    this.operationTail = next.then(() => undefined, () => undefined)
    return next
  }

  protected async [Service.init](): Promise<void> {
    let domain!: Domain<typeof sessionPinsDomainSpec>
    await this.ctx.effect(async () => {
      domain = await this.ctx.storageDomain.open(sessionPinsDomainSpec)
      return () => {
        this.global = undefined
        return domain.close()
      }
    }, 'session-pins.domainClose')
    if (this.ctx.fiber.uid === null) return
    this.global = domain.global
    this.ctx.effect(() => this.ctx.sessionFlags.registerProvider({
      id: 'session-pins',
      list: () => {
        const flags: Record<SessionId, { pinned: true }> = {}
        for (const id of this.requireState().pinnedSessionIds) flags[id] = { pinned: true }
        return flags
      },
    }), 'session-pins.flagProvider')
  }

  /**
   * Whether the pins domain is open. A consumer that projects this service's
   * state from `ctx.get('sessionPins')` reads this first: the service is
   * registered while its initialization is still pending, and `list()` throws
   * until the domain opens.
   *
   * @returns true once the domain is open and every mutation is durable.
   */
  get ready(): boolean {
    return this.global !== undefined
  }

  private requireState(): SessionPinsDomainState {
    return this.requireGlobal().get()
  }

  private requireGlobal(): DomainGlobal<SessionPinsDomainState> {
    const global = this.global
    if (global === undefined) throw new Error('session-pins domain is not open')
    return global
  }

  private async commit(state: SessionPinsDomainState): Promise<SessionPinsSnapshot> {
    await this.requireGlobal().set(state)
    return snapshotOf(state)
  }

  /**
   * Read the current durable pin state without exposing its mutable storage arrays.
   *
   * @returns A detached snapshot of the pin set and its order overrides.
   */
  @Remote('list')
  list(): SessionPinsSnapshot {
    return snapshotOf(this.requireState())
  }

  /**
   * Add or remove one session id and persist the complete pin state.
   *
   * @param input - Session id and desired pin membership.
   * @returns The committed pin snapshot.
   */
  @Remote('setPinned')
  setPinned(input: { sessionId: string; pinned: boolean }): Promise<SessionPinsSnapshot> {
    return this.enqueue(async () => {
      this.assertSessionId(input.sessionId)
      const sessionId = SessionId(input.sessionId)
      const current = this.requireState()
      const pinnedSessionIds = new Set(current.pinnedSessionIds)
      let groupOrder: Record<string, SessionId[]>
      if (input.pinned) {
        pinnedSessionIds.add(sessionId)
        groupOrder = cloneOrder(current.groupOrder)
      } else {
        pinnedSessionIds.delete(sessionId)
        groupOrder = {}
        for (const [key, ids] of Object.entries(cloneOrder(current.groupOrder))) {
          const next = ids.filter(id => id !== sessionId)
          if (next.length > 0) groupOrder[key] = next
        }
      }
      const flatOrder = reconcileFlatOrder(current.flatOrder, pinnedSessionIds)
      return this.commit({ ...current, pinnedSessionIds: [...pinnedSessionIds], groupOrder, flatOrder })
    })
  }

  /**
   * Persist an order override for the supplied pinned sessions in one group.
   *
   * @param input - Group key and pinned session ids in display order.
   * @returns The committed pin snapshot.
   */
  @Remote('reorderGroup')
  reorderGroup(input: { groupKey: string; orderedIds: string[] }): Promise<SessionPinsSnapshot> {
    return this.enqueue(async () => {
      this.assertGroupKey(input.groupKey)
      const ordered = this.assertOrderedIds(input.orderedIds)
      const current = this.requireState()
      const pinned = new Set(current.pinnedSessionIds)
      if (ordered.some(id => !pinned.has(id)) || new Set(ordered).size !== ordered.length) {
        throw new SessionPinsInvalidError(ordered)
      }
      return this.commit({ ...current, groupOrder: { ...cloneOrder(current.groupOrder), [input.groupKey]: ordered } })
    })
  }

  /**
   * Persist the flat-view order for the complete pin set.
   *
   * @param input - Every pinned session id in display order.
   * @returns The committed pin snapshot.
   */
  @Remote('reorderFlat')
  reorderFlat(input: { orderedIds: string[] }): Promise<SessionPinsSnapshot> {
    return this.enqueue(async () => {
      const ordered = this.assertOrderedIds(input.orderedIds)
      const current = this.requireState()
      const pinned = new Set(current.pinnedSessionIds)
      if (ordered.length !== pinned.size || ordered.some(id => !pinned.has(id))
        || new Set(ordered).size !== ordered.length) {
        throw new SessionPinsInvalidError(ordered)
      }
      return this.commit({ ...current, flatOrder: ordered })
    })
  }

  private assertSessionId(value: string): void {
    if (value.trim() === '' || value.length > 256) {
      throw new SessionPinsInvalidError([])
    }
  }

  private assertGroupKey(value: string): void {
    if (value.length > 256) throw new SessionPinsInvalidError([])
  }

  private assertOrderedIds(values: readonly string[]): SessionId[] {
    if (values.length > 10_000) throw new SessionPinsInvalidError([])
    for (const value of values) this.assertSessionId(value)
    return values.map(SessionId)
  }
}

export default SessionPinsService
