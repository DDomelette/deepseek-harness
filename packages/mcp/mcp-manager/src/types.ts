/**
 * Per-server runtime status, list views, and the MCP manager's Cordis event.
 * Types only — no runtime code.
 *
 * @module @deepseek-ai/dsh-mcp-manager/types
 */

import type { McpCloseResult, McpConnectionStatus } from '@deepseek-ai/dsh-mcp-client/types'

/**
 * Status of one managed server. Extends the mcp-client connection status with
 * manager-owned conditions: `disabled` when the configured entry requests no
 * live instance, `load` when plugin activation failed, and `cleanup` when an
 * instance or probe could not confirm closure or finish local cleanup.
 * Cleanup results retain any unconfirmed closure and the first diagnostic.
 */
export type McpManagedServerStatus =
  | McpConnectionStatus
  | { state: 'disabled' }
  | { state: 'failed'; reason: 'load'; lastError: string }
  | { state: 'failed'; reason: 'cleanup'; result: McpCloseResult }

/** One managed server as a management surface lists it. */
export interface McpManagedServerView {
  /** The configured `servers` key or registered name; also the instance's `serverName` tool namespace. */
  name: string
  /** Whether a configured or registered entry still exists; false for retained cleanup failures after removal. */
  configured: boolean
  /** Current runtime status. */
  status: McpManagedServerStatus
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One managed server's status transitioned. Emitted for every published
     * change while the manager is live and either the entry is configured or
     * registered, or a runtime record remains. Removed entries may emit cleanup
     * failures; `watch` and `list()` report removals.
     * Lifecycle operations do not wait for listeners. Synchronous throws and
     * returned promise rejections are logged without skipping other listeners.
     * @param name - the configured `servers` key or registered name.
     * @param status - the status now current for that server.
     * @mode parallel
     */
    'mcp-manager/status'(name: string, status: McpManagedServerStatus): void | Promise<void>
  }
}

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
