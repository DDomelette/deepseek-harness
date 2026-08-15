/** Wire types of the `mcpServers` Remote face. */

import type {} from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The settings-managed MCP roster or one mount lifecycle state changed.
     * This is an unfiltered invalidation notification; consumers refetch the
     * roster through `mcpServers.list()`.
     * @mode emit
     */
    'mcp-servers/change'(): void
  }
}

/**
 * Mount lifecycle of one settings-managed MCP server: `connecting` while its
 * mcp-client fiber has not settled, `ready` once activation settled, `failed`
 * when activation rejected. This is never live connection health — with
 * `failOnStartupError: false` an unreachable server still reports `ready`
 * while mcp-client keeps reconnecting.
 */
export type McpServerStatus = 'connecting' | 'ready' | 'failed'

/** One MCP server row exposed to the trusted Web client. */
export interface McpServerListEntry {
  /** Stable local namespace (`mcp__<serverName>__<tool>`). */
  readonly serverName: string
  /** Transport the entry connects over. */
  readonly transport: 'stdio' | 'streamable-http'
  /** Managing plane: settings panel or cordis.yml declaration. */
  readonly source: 'settings' | 'declarative'
  /** Effective enablement; declarative rows mirror `!entry.disabled`. */
  readonly enabled: boolean
  /**
   * Mount lifecycle (see {@link McpServerStatus}) of an enabled settings row;
   * null for disabled settings rows and every declarative row, whose lifecycle
   * cordis.yml owns.
   */
  readonly status: McpServerStatus | null
  /** Startup failure summary when status is 'failed'. */
  readonly error?: string
}

/** Point-in-time roster returned by the mcpServers Remote. */
export interface McpServerSnapshot {
  readonly entries: readonly McpServerListEntry[]
}
