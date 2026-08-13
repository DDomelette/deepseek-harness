/**
 * Settings schema for the `mcp-servers` namespace: a dict keyed by serverName
 * whose entries mirror the `dsh-mcp-client` Config fields plus `enabled`.
 *
 * @module @deepseek-ai/dsh-mcp-manager
 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owning the panel-managed MCP server roster. */
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
}

/** Fully resolved settings entry for one Streamable HTTP MCP server. */
export interface McpHttpEntry {
  enabled: boolean
  transport: 'streamable-http'
  url: string
  headers: Record<string, string>
  toolCallTimeoutMs: number
  failOnStartupError: boolean
}

/** Fully resolved settings entry for one MCP server. */
export type McpServerEntryConfig = McpStdioEntry | McpHttpEntry

/** Resolved `mcp-servers` section: dict keyed by serverName. */
export type McpServersSection = Record<string, McpServerEntryConfig>

const stdioEntry = z.object({
  enabled: z.boolean().default(true),
  transport: z.const('stdio'),
  command: z.string().required(),
  args: z.array(String).default([]),
  env: z.dict(String).default({}).role('secret'),
  cwd: z.string().default(''),
  toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
  failOnStartupError: z.boolean().default(false),
})

const httpEntry = z.object({
  enabled: z.boolean().default(true),
  transport: z.const('streamable-http'),
  url: z.string().required(),
  headers: z.dict(String).default({}).role('secret'),
  toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
  failOnStartupError: z.boolean().default(false),
})

/** Schema of one dict entry; the key carries the serverName. */
export const McpServerEntrySchema = z.union([stdioEntry, httpEntry]) as unknown as z<McpServerEntryConfig>

/** Schema of the whole `mcp-servers` section. */
export const McpServersSchema = z.dict(McpServerEntrySchema) as unknown as z<McpServersSection>
