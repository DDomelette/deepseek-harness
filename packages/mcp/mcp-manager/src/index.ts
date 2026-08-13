/**
 * MCP server manager: owns the `mcp-servers` settings namespace, hot-mounts
 * one dsh-mcp-client instance per enabled entry, and projects declarative
 * (cordis.yml) servers read-only alongside them. The default export is the
 * plugin the Loader mounts: the `mcpServers` Remote gateway, whose lifecycle
 * owns the namespace registration and the supervisor.
 *
 * @module @deepseek-ai/dsh-mcp-manager
 */

import type { Context } from '@deepseek-ai/cordis'
import { McpServersGateway } from './gateway.ts'

export * from './schema.ts'
export * from './declarative.ts'
export * from './supervisor.ts'
export type * from './types.ts'
export { McpServersGateway } from './gateway.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-manager'

/** Services required by this plugin. */
export const inject = ['settings', 'loader']

/**
 * Mount the manager as its gateway plugin: the gateway owns the namespace
 * registration, the supervisor, and the Remote face in one fiber, so the
 * namespace-apply and Loader default-export paths compose identically.
 * @param ctx - host context carrying settings and loader services.
 */
export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(McpServersGateway)
}

export default McpServersGateway
