import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
/** MCP server roster as a Web settings section. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import { type Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the settings surface's ctx.configForms Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the ctx.remote Context merge and the mcpServers wire types.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { McpSettingsTab, type McpSettingsTabInjected } from './McpSettingsTab.tsx'
import { MCP_SERVERS_NS, McpTabController, type McpServersSettings } from './mcp-tab-controller.ts'
import { en, zh, type McpLocaleKey } from './locales.ts'

export type { McpSettingsTabInjected, McpSettingsTabProps } from './McpSettingsTab.tsx'
export type { McpLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP server roster copy. */
    'settings.mcp': McpLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.mcp'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.mcpServers', 'configForms']

/** Contribute the MCP roster as its own settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-mcp: dictionaries')
  const t = ctx.locale.bind(NS)
  const controller = new McpTabController(
    ctx.configForms.get<McpServersSettings>(MCP_SERVERS_NS),
    ctx.remote.mcpServers,
  )
  const face = controller.face()
  const injected = (): McpSettingsTabInjected => ({
    ...face,
    subscribeRoster: (listener) => {
      const disposers = [
        ctx.remote.$on('mcp-servers/change', listener),
        ctx.on('connection/reset', listener),
      ]
      return () => { for (const dispose of disposers) dispose() }
    },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mcp',
    order: 35,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, McpSettingsTab))
}
