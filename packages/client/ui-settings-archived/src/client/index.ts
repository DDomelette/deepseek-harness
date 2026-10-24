import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
/**
 * Archived settings plugin, browser half: the Archived page of the settings
 * shell, with restore and recursive delete actions.
 *
 * Export discipline: packages/client/AGENTS.md.
 */

import { type Context as ClientContext } from '@deepseek-ai/cordis'
import { type ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { type IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ArchivedSection, type ArchivedSectionInjected } from './ArchivedSection.tsx'
import { en, zh, type ArchivedSettingsKey } from './locales.ts'

export type { ArchivedSectionInjected, ArchivedSectionProps } from './ArchivedSection.tsx'
export type { ArchivedSettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.archived': ArchivedSettingsKey
  }
}

const NS = 'settings.archived'

export const inject = ['slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-archived: copy dictionaries')
  const sessions = ctx.get('sessions') as ISessions
  const workspaces = ctx.get('workspaces') as IWorkspaces
  const uiWorkspace = ctx.get('uiWorkspace') as UiWorkspace
  const t = ctx.locale.bind(NS)
  const injected = (): ArchivedSectionInjected => ({
    restore: async (sessionId) => {
      await workspaces.unarchiveSession(sessionId)
      if (sessions.list.getSnapshot().byId[sessionId] !== undefined) {
        uiWorkspace.openSession(sessionId)
        return true
      }
      return false
    },
    remove: async (sessionId) => {
      const result = await sessions.deleteSession(sessionId)
      if (!result.ok) throw new Error(result.error.message)
    },
    refresh: async () => { await sessions.refresh() },
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'archived',
    order: 40,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, ArchivedSection))
}
