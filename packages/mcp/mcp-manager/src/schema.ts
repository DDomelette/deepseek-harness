/**
 * Settings schema for the `mcp-servers` namespace: a dict keyed by serverName
 * whose entries mirror the `dsh-mcp-client` Config fields plus `enabled`.
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
  enabled: boolean
  transport: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
  toolCallTimeoutMs: number
  failOnStartupError: boolean
  reconnect: Required<ReconnectConfig>
}

/** Fully resolved settings entry for one Streamable HTTP MCP server. */
export interface McpHttpEntry {
  enabled: boolean
  transport: 'streamable-http'
  url: string
  headers: Record<string, string>
  toolCallTimeoutMs: number
  failOnStartupError: boolean
  reconnect: Required<ReconnectConfig>
}

/** Fully resolved settings entry for one MCP server. */
export type McpServerEntryConfig = McpStdioEntry | McpHttpEntry

/** Resolved `mcp-servers` section: dict keyed by serverName. */
export type McpServersSection = Record<string, McpServerEntryConfig>

/**
 * The section as the manager's own Config holds it. The reference stays stable
 * for the instance's lifetime, so a settings edit that touches only this
 * section commits into the running plugin without remounting it.
 */
export type McpServersConfig = Volatile<McpServersSection>

/** Detached section read from {@link McpServersConfig}; every level is readonly. */
export type McpServersSnapshot = VolatileSnapshot<McpServersSection>

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
 * than by the roster that would mount it. The root is volatile because the
 * section is edited while the manager runs: the settings seam only accepts a
 * path beneath a volatile node.
 */
export const McpServersSchema = z.dict(McpServerEntrySchema, z.string().pattern(SERVER_NAME_PATTERN))
  .default({})
  .volatile() as unknown as z<McpServersConfig>
