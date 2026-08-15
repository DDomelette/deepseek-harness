import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
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

/** Injectable business face shared by the three slot entries. */
export interface PinnedSessionsInjected {
  open: (sessionId: SessionId) => void
  setPinned: (sessionId: SessionId, pinned: boolean, previous: SessionPinsSnapshot) => Promise<void>
  reorderGroup: (groupKey: string, orderedIds: readonly SessionId[], previous: SessionPinsSnapshot) => Promise<void>
  reorderFlat: (orderedIds: readonly SessionId[], previous: SessionPinsSnapshot) => Promise<void>
}

/** Services required by the pinned-sessions client plugin. */
export const inject = ['slots', 'locale', 'sessions', 'remote']

/** Register the pinned section, row action, and search badge entries. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-pinned-sessions: dictionaries')
  const store = createPinnedSessionsStore()
  const remote = ctx.remote.sessionPins
  let bound: BoundActions<typeof store> | undefined
  let refresh: Promise<void> | null = null

  const commitRemote = (snapshot: SessionPinsSnapshot): void => {
    bound?.commit(snapshot)
  }
  const reload = (): Promise<void> => {
    refresh ??= remote.list().then((result) => {
      if (!result.ok) throw new Error(`sessionPins.list failed: ${result.error.code}: ${result.error.message}`)
      commitRemote(result.value)
    }).catch((reason: unknown) => { bound?.fail(String(reason)) }).finally(() => { refresh = null })
    return refresh
  }
  ctx.effect(() => ctx.on('connection/reset', () => { void reload() }), 'ui-pinned-sessions: reset refresh')

  const injected = (actions: BoundActions<typeof store>): PinnedSessionsInjected => {
    bound = actions
    void reload()
    return {
      open: (sessionId) => { ctx.sessions.open(sessionId) },
      setPinned: async (sessionId, pinned, previous) => {
        if (pinned) actions.optimistic({
          ...previous,
          pinnedSessionIds: previous.pinnedSessionIds.includes(sessionId)
            ? previous.pinnedSessionIds
            : [...previous.pinnedSessionIds, sessionId],
        })
        const result = await remote.setPinned({ sessionId, pinned })
        if (!result.ok) {
          actions.rollback(previous)
          throw new Error(`sessionPins.setPinned failed: ${result.error.code}: ${result.error.message}`)
        }
        actions.commit(result.value)
      },
      reorderGroup: async (groupKey, orderedIds, previous) => {
        actions.optimistic({ ...previous, groupOrder: { ...previous.groupOrder, [groupKey]: orderedIds } })
        const result = await remote.reorderGroup({ groupKey, orderedIds: [...orderedIds] })
        if (!result.ok) {
          actions.rollback(previous)
          throw new Error(`sessionPins.reorderGroup failed: ${result.error.code}: ${result.error.message}`)
        }
        actions.commit(result.value)
      },
      reorderFlat: async (orderedIds, previous) => {
        actions.optimistic({ ...previous, flatOrder: orderedIds })
        const result = await remote.reorderFlat({ orderedIds: [...orderedIds] })
        if (!result.ok) {
          actions.rollback(previous)
          throw new Error(`sessionPins.reorderFlat failed: ${result.error.code}: ${result.error.message}`)
        }
        actions.commit(result.value)
      },
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
