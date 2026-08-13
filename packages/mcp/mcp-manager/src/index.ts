/**
 * MCP server manager: owns the `mcp-servers` settings namespace, hot-mounts
 * one dsh-mcp-client instance per enabled entry, and projects declarative
 * (cordis.yml) servers read-only alongside them.
 *
 * @module @deepseek-ai/dsh-mcp-manager
 */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { declarativeMcpServers } from './declarative.ts'
import { MCP_SERVERS_NS, McpServersSchema, SERVER_NAME_PATTERN } from './schema.ts'
import type { McpServersSection } from './schema.ts'
import { McpServerSupervisor } from './supervisor.ts'

export * from './schema.ts'
export * from './declarative.ts'
export * from './supervisor.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-manager'

/** Services required by this plugin. */
export const inject = ['settings', 'loader']

/**
 * Register the namespace, mount the supervisor on the current section, and
 * keep the roster reconciled on every later commit. Effects dispose in
 * reverse registration order, so the watch detaches before the roster tears
 * down.
 * @param ctx - host context carrying settings and loader services.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings', 'loader'], (sctx) => {
    const scope = sctx.settings.register(settingsNamespace(MCP_SERVERS_NS), McpServersSchema, {
      applies: 'live',
      validate: (section: McpServersSection) => {
        const declarative = new Set(declarativeMcpServers(sctx).map(server => server.serverName))
        for (const key of Object.keys(section)) {
          if (!SERVER_NAME_PATTERN.test(key)) {
            throw new Error(`mcp-servers: serverName "${key}" must match ${String(SERVER_NAME_PATTERN)}`)
          }
          if (declarative.has(key)) {
            throw new Error(`mcp-servers: serverName "${key}" is already declared in cordis.yml — pick a unique name`)
          }
        }
      },
    })
    const supervisor = new McpServerSupervisor(sctx)
    supervisor.sync(scope.get())
    sctx.effect(() => () => supervisor.dispose(), 'mcp-manager: roster teardown')
    sctx.effect(() => scope.watch((next) => { supervisor.sync(next) }), 'mcp-manager: settings watch')
  })
}
