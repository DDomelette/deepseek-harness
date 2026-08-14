/**
 * Bridge between the MCP roster tab and its two data sources: the
 * `mcp-servers` settings scope (enablement writes) and the `mcpServers`
 * Remote (roster reads). The tab never sees ctx; this controller is the
 * apply-closure half that turns both services into the tab's injected face.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: the wire types plus the ctx.remote Context merge carrying the
// generated `mcpServers` namespace face.
import type { McpServerSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { McpSettingsTabInjected } from './McpSettingsTab.tsx'
import type { NewServerDraft } from './AddServerForm.tsx'
import type { ServerPatch } from './EditServerForm.tsx'
import type { McpLocaleKey } from './locales.ts'

/**
 * Settings namespace owning the panel-managed MCP roster. Spelled here rather
 * than imported: a client package must not depend on a Host package.
 */
export const MCP_SERVERS_NS = 'mcp-servers'

/**
 * The redacted fields of one `mcp-servers` section entry this tab reads. The
 * section entry also carries `env`/`headers` secrets the wire never returns;
 * every write therefore names the leaf fields it means instead of rebuilding
 * the entry.
 */
export interface McpServerSettingsEntry {
  /** Effective enablement of the server. */
  readonly enabled: boolean
  /** Transport the entry connects over. */
  readonly transport: 'stdio' | 'streamable-http'
  /** stdio launch command. */
  readonly command?: string
  /** stdio arguments. */
  readonly args?: string[]
  /** stdio working directory. */
  readonly cwd?: string
  /** Streamable HTTP endpoint URL. */
  readonly url?: string
  /** Per-tool-call timeout in milliseconds. */
  readonly toolCallTimeoutMs?: number
}

/** The `mcp-servers` section as the scope snapshot presents it: a dict keyed by serverName. */
export type McpServersSettings = Record<string, McpServerSettingsEntry>

/** The generated `mcpServers` Remote namespace face, narrowed from ctx.remote. */
type McpServersRemote = Context['remote']['mcpServers']

/** Bridges the `mcp-servers` scope and the mcpServers Remote onto the tab's injected face. */
export class McpTabController {
  /**
   * @param scope - the bound settings scope of the `mcp-servers` namespace.
   * @param remote - the generated `mcpServers` Remote namespace face.
   */
  constructor(
    private readonly scope: SettingsScope<McpServersSettings>,
    private readonly remote: McpServersRemote,
  ) {}

  /**
   * Build the face the tab's slot registration injects.
   * @returns roster reads plus enablement writes.
   */
  face(): McpSettingsTabInjected {
    return {
      list: () => this.list(),
      setEnabled: (serverName, enabled) => this.setEnabled(serverName, enabled),
      addServer: draft => this.addServer(draft),
      readEntry: serverName => this.scope.getSnapshot().value?.[serverName],
      updateServer: (serverName, patch) => this.updateServer(serverName, patch),
      removeServer: serverName => this.removeServer(serverName),
    }
  }

  private async list(): Promise<McpServerSnapshot> {
    const result = await this.remote.list()
    if (!result.ok) {
      throw new Error(`mcpServers.list failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }

  /**
   * Flip one settings-managed server's enablement through a deep path op. Only
   * the `enabled` leaf is replaced, so sibling fields — including `env` and
   * `headers` secrets the redacted scope snapshot never carried — keep their
   * stored values. A row the accepted section does not hold (the scope still
   * loading, or the entry removed concurrently) is left alone — the scope's
   * next publication re-syncs the roster.
   */
  private async setEnabled(serverName: string, enabled: boolean): Promise<void> {
    if (this.scope.getSnapshot().value?.[serverName] === undefined) return
    await this.scope.setPath([serverName, 'enabled'], enabled)
  }

  /**
   * Persist one new server as a single whole-entry path op. The entry is new
   * and the draft carries every field the form collected — secrets included —
   * so a whole-entry write loses nothing. The settings schema remains the
   * server-side pattern guard; the scope's recovery read decides acceptance.
   * @param draft - validated form draft.
   * @returns null when the Host accepted the entry, otherwise the failure key.
   */
  private async addServer(draft: NewServerDraft): Promise<McpLocaleKey | null> {
    const { serverName, ...entry } = draft
    await this.scope.set(serverName, entry)
    return this.scope.getSnapshot().value?.[serverName] === undefined ? 'saveFailed' : null
  }

  /**
   * Apply one incremental patch as per-field deep path ops. Only the leaves
   * the patch names are written, so secret fields the edit form left blank
   * keep their stored values. The Host's schema validation remains the
   * authority; the roster re-read after the tab closes shows what landed.
   * @param serverName - the row's server name.
   * @param patch - the fields the user changed.
   * @returns null after the queued writes, or the failure key when the scope
   * holds no accepted entry for the row.
   */
  private async updateServer(serverName: string, patch: ServerPatch): Promise<McpLocaleKey | null> {
    if (this.scope.getSnapshot().value?.[serverName] === undefined) return 'loadFailed'
    for (const [field, value] of Object.entries(patch)) {
      await this.scope.setPath([serverName, field], value)
    }
    return null
  }

  /**
   * Remove one server entry wholesale. The whole-entry unset is safe for
   * removal: nothing survives the delete, so redacted secrets need no
   * preservation.
   * @param serverName - the row's server name.
   * @returns settlement of the queued settings clear.
   */
  private async removeServer(serverName: string): Promise<void> {
    await this.scope.unset(serverName)
  }
}
