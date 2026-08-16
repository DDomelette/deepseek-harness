import type { BoundActions, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-session-pins/remote'
import type { SessionPinsSnapshot } from '@deepseek-ai/dsh-session-pins/types'
import { createPinnedSessionsStore } from './stores.ts'
import { PinnedSection } from './PinnedSection.tsx'
import { SessionPinAction } from './SessionPinAction.tsx'
import { SearchPinBadge } from './SearchPinBadge.tsx'
import { en, zh, type SessionPinsKey } from './locales.ts'

export type { SessionPinsSnapshot } from './stores.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The pinned-sessions section and row action copy. */
    sessionPins: SessionPinsKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'sessionPins'

/** Injectable business face required by the row pin button. */
export interface SessionPinInjected {
  setPinned: (sessionId: SessionId, pinned: boolean, previous: SessionPinsSnapshot) => Promise<void>
}

/** Injectable business face shared by the three slot entries. */
export interface PinnedSessionsInjected extends SessionPinInjected {
  open: (sessionId: SessionId) => void
  setPinned: (sessionId: SessionId, pinned: boolean, previous: SessionPinsSnapshot) => Promise<void>
  reorderGroup: (groupKey: string, orderedIds: readonly SessionId[], previous: SessionPinsSnapshot) => Promise<void>
  reorderFlat: (orderedIds: readonly SessionId[], previous: SessionPinsSnapshot) => Promise<void>
  renameSession: (sessionId: SessionId, title: string) => Promise<void>
  forkSession: (sessionId: SessionId) => void
  archiveSession: (sessionId: SessionId) => Promise<void>
  workspaceT: TranslateNS<'workspace'>
}

const EMPTY: SessionPinsSnapshot = { pinnedSessionIds: [], groupOrder: {}, flatOrder: [] }

const flagsOf = (snapshot: SessionPinsSnapshot): Readonly<Record<SessionId, { pinned: true }>> => {
  const flags: Record<SessionId, { pinned: true }> = {}
  for (const id of snapshot.pinnedSessionIds) flags[id] = { pinned: true }
  return flags
}

/** Services required by the pinned-sessions client plugin. */
export const inject = ['slots', 'locale', 'sessions', 'workspaces', 'remote', 'remote.sessionPins']

/** Register the pinned section, row action, and search badge entries. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-pinned-sessions: dictionaries')
  const store = createPinnedSessionsStore()
  const remote = ctx.remote.sessionPins
  const workspaceT = ctx.locale.bind('workspace')
  let bound: BoundActions<typeof store> | undefined
  let latest: SessionPinsSnapshot = EMPTY
  let tail: Promise<void> = Promise.resolve()

  const publish = (snapshot: SessionPinsSnapshot): void => {
    latest = snapshot
    ctx.workspaces.installSessionFlags(flagsOf(snapshot))
  }
  const commit = (snapshot: SessionPinsSnapshot): void => {
    bound?.commit(snapshot)
    publish(snapshot)
  }
  const reload = (): Promise<void> => {
    const operation = tail.then(async () => {
      const result = await remote.list()
      if (!result.ok) throw new Error(`sessionPins.list failed: ${result.error.code}: ${result.error.message}`)
      commit(result.value)
    })
    tail = operation.then(() => undefined, () => undefined)
    return operation
  }
  ctx.effect(() => ctx.on('connection/reset', () => { void reload() }), 'ui-pinned-sessions: reset refresh')

  const injected = (actions: BoundActions<typeof store>): PinnedSessionsInjected => {
    bound = actions
    void reload()
    const enqueue = (operation: () => Promise<void>): Promise<void> => {
      const next = tail.then(operation, operation)
      tail = next.then(() => undefined, () => undefined)
      return next
    }
    return {
      open: (sessionId) => { ctx.sessions.open(sessionId) },
      setPinned: (sessionId, pinned, _previous) => enqueue(async () => {
        const base = latest
        const next: SessionPinsSnapshot = pinned
          ? {
            ...base,
            pinnedSessionIds: base.pinnedSessionIds.includes(sessionId)
              ? base.pinnedSessionIds
              : [...base.pinnedSessionIds, sessionId],
          }
          : {
            ...base,
            pinnedSessionIds: base.pinnedSessionIds.filter(id => id !== sessionId),
            groupOrder: Object.fromEntries(Object.entries(base.groupOrder).flatMap(([key, order]) => {
              const next = order.filter(id => id !== sessionId)
              return next.length === 0 ? [] : [[key, next]]
            })),
            flatOrder: base.flatOrder.filter(id => id !== sessionId),
          }
        actions.optimistic(next)
        publish(next)
        const result = await remote.setPinned({ sessionId, pinned })
        if (!result.ok) {
          actions.rollback(base)
          publish(base)
          throw new Error(`sessionPins.setPinned failed: ${result.error.code}: ${result.error.message}`)
        }
        commit(result.value)
      }),
      reorderGroup: (groupKey, orderedIds, _previous) => enqueue(async () => {
        const base = latest
        actions.optimistic({ ...base, groupOrder: { ...base.groupOrder, [groupKey]: orderedIds } })
        const result = await remote.reorderGroup({ groupKey, orderedIds: [...orderedIds] })
        if (!result.ok) {
          actions.rollback(base)
          throw new Error(`sessionPins.reorderGroup failed: ${result.error.code}: ${result.error.message}`)
        }
        commit(result.value)
      }),
      reorderFlat: (orderedIds, _previous) => enqueue(async () => {
        const base = latest
        actions.optimistic({ ...base, flatOrder: orderedIds })
        const result = await remote.reorderFlat({ orderedIds: [...orderedIds] })
        if (!result.ok) {
          actions.rollback(base)
          throw new Error(`sessionPins.reorderFlat failed: ${result.error.code}: ${result.error.message}`)
        }
        commit(result.value)
      }),
      renameSession: async (sessionId, title) => {
        const session = ctx.sessions.binding(sessionId)?.session
        if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
        const result = await session.rename(title)
        if (!result.ok) throw new Error(result.error.message)
      },
      forkSession: (sessionId) => {
        ctx.sessions.fork({ sessionId, increaseTitle: true })
          .then((childId) => { ctx.sessions.open(childId) })
          .catch(() => {})
      },
      archiveSession: async (sessionId) => {
        await ctx.workspaces.archiveSession(sessionId)
      },
      workspaceT,
    }
  }

  ctx.slots.inject('sidebar.workspaces.pinned', () => ctx.slots.register({
    name: 'sidebar.workspaces.pinned', store, locale: NS, inject: injected,
  }, PinnedSection))
  ctx.slots.inject('sidebar.workspaces.sessionActions', () => ctx.slots.register({
    name: 'sidebar.workspaces.sessionActions', id: 'pin', order: -10, store, locale: NS, inject: injected,
  }, SessionPinAction))
  ctx.slots.inject('sidebar.workspaces.searchResultExtra', () => ctx.slots.register({
    name: 'sidebar.workspaces.searchResultExtra', id: 'pin', store, locale: NS, inject: injected,
  }, SearchPinBadge))
}
