/**
 * Settings schema for the `mcp-servers` namespace: a `servers` dict keyed by
 * serverName whose entries mirror the `dsh-mcp-client` Config fields plus
 * `enabled`.
 *
 * @module @deepseek-ai/dsh-mcp-manager
 */

import z from '@deepseek-ai/schemastery'
import type { Volatile, VolatileSnapshot } from '@deepseek-ai/cordis'
import { ReconnectConfigSchema } from '@deepseek-ai/dsh-mcp-client'
import type { ReconnectConfig } from '@deepseek-ai/dsh-mcp-client'

/**
 * Settings namespace owning the panel-managed MCP server roster. A namespace
 * IS its Loader entry id, so the composition's manager row must carry this id
 * for the Web MCP tab, which binds the same key, to address the section.
 */
export const MCP_SERVERS_NS = 'mcp-servers'

/** Valid serverName, identical to the mcp-client constraint. */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** Default per-tool-call timeout, identical to mcp-client. */
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/** Fully resolved settings entry for one stdio MCP server. */
export interface McpStdioEntry {
  /** Whether the entry is in effect; a disabled entry mounts no client. */
  enabled: boolean
  /** Selects child-process stdio transport. */
  transport: 'stdio'
  /** Executable used to start the server. */
  command: string
  /** Arguments passed directly, without shell interpolation. */
  args: string[]
  /** Extra env vars merged on top of scrubbed ambient env. */
  env: Record<string, string>
  /** Working directory for the child process. */
  cwd: string
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail the mount when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Automatic reconnect policy after a lost connection. */
  reconnect: Required<ReconnectConfig>
}

/** Fully resolved settings entry for one Streamable HTTP MCP server. */
export interface McpHttpEntry {
  /** Whether the entry is in effect; a disabled entry mounts no client. */
  enabled: boolean
  /** Selects Streamable HTTP transport. */
  transport: 'streamable-http'
  /** MCP endpoint URL. */
  url: string
  /** Additional headers attached to MCP requests. */
  headers: Record<string, string>
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail the mount when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Automatic reconnect policy after a lost connection. */
  reconnect: Required<ReconnectConfig>
}

/** Fully resolved settings entry for one MCP server. */
export type McpServerEntryConfig = McpStdioEntry | McpHttpEntry

/** Panel-managed server roster: one resolved entry per serverName. */
export type McpServersRoster = Record<string, McpServerEntryConfig>

/**
 * The `mcp-servers` section as the manager's own Config holds it. The `servers`
 * reference stays stable for the instance's lifetime, so a settings edit that
 * touches only this section commits into the running plugin without remounting it.
 */
export interface McpServersConfig {
  /** Panel-managed roster, keyed by serverName. */
  readonly servers: Volatile<McpServersRoster>
}

/** Detached roster read from {@link McpServersConfig.servers}; every level is readonly. */
export type McpServersSnapshot = VolatileSnapshot<McpServersRoster>

const stdioEntry = z.object({
  enabled: z.boolean().default(true),
  transport: z.const('stdio'),
  command: z.string().required(),
  args: z.array(String).default([]),
  env: z.dict(String).default({}).role('secret'),
  cwd: z.string().default(''),
  toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
  failOnStartupError: z.boolean().default(false),
  reconnect: ReconnectConfigSchema,
})

const httpEntry = z.object({
  enabled: z.boolean().default(true),
  transport: z.const('streamable-http'),
  url: z.string().required(),
  headers: z.dict(String).default({}).role('secret'),
  toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
  failOnStartupError: z.boolean().default(false),
  reconnect: ReconnectConfigSchema,
})

/** Schema of one dict entry; the key carries the serverName. */
export const McpServerEntrySchema = z.union([stdioEntry, httpEntry]) as unknown as z<McpServerEntryConfig>

/**
 * Schema of the whole `mcp-servers` section: the manager's Config, and the form
 * the settings page renders it from. The key schema carries the serverName
 * grammar, so an unusable name is refused where the section is validated rather
 * than by the roster that would mount it. `servers` is volatile because the
 * section is edited while the manager runs: the settings seam only accepts a
 * path beneath a volatile node, and a commit touching only this field reaches
 * the running plugin without a remount. An omitted section resolves to an empty
 * roster.
 */
export const McpServersSchema = z.object({
  servers: z.dict(McpServerEntrySchema, z.string().pattern(SERVER_NAME_PATTERN)).default({}).volatile(),
}).default({}) as unknown as z<McpServersConfig>
