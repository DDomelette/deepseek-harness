/**
 * MCP server manager: owns the `mcp-servers` settings namespace, hot-mounts
 * one dsh-mcp-client instance per enabled entry, and projects declarative
 * (cordis.yml) servers read-only alongside them. The default export is the
 * plugin the Loader mounts: the `mcpServers` Remote gateway, whose lifecycle
 * owns the namespace registration and the supervisor.
 *
 * @module @deepseek-ai/dsh-mcp-manager
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { declarativeMcpServers } from './declarative.ts'
import { MCP_SERVERS_NS, McpServersSchema, SERVER_NAME_PATTERN } from './schema.ts'
import type { McpServersSection } from './schema.ts'
import { McpServerSupervisor, supervisorFor, trackSupervisor } from './supervisor.ts'
import type { McpServerListEntry, McpServerSnapshot } from './types.ts'

export * from './schema.ts'
export * from './declarative.ts'
export * from './supervisor.ts'
export type * from './types.ts'

/**
 * Manager plugin and read-only Remote over the MCP server roster. The Loader
 * mounts this class (the package's default export), so one cordis.yml row
 * composes the whole feature: `mcp-servers` namespace registration, the
 * hot-mount supervisor, and the `mcpServers` Remote face.
 *
 * The roster projection covers exactly two planes: the settings-managed
 * entries the supervisor owns, and mcp-client entries declared in cordis.yml.
 * MCP servers an agent preset mounts inline never appear in
 * `ctx.loader.entries()` (packages/preset/agent-presets/README.md), so they
 * are absent here by design — a preset composes one session, while this
 * Remote answers for the host.
 */
export class McpServersGateway extends TypertRemoteService {
  static inject = ['settings', 'loader']

  /**
   * @param ctx - host context carrying settings and loader services.
   */
  constructor(ctx: Context) {
    super(ctx, 'mcpServers')
  }

  /**
   * Register the namespace, mount the supervisor on the current section, and
   * keep the roster reconciled on every later commit. Effects dispose in
   * reverse registration order, so the watch detaches before the roster tears
   * down and the supervisor stays published until teardown finished.
   */
  protected [Service.init](): void {
    const scope = this.ctx.settings.register(settingsNamespace(MCP_SERVERS_NS), McpServersSchema, {
      applies: 'live',
      validate: (section: McpServersSection) => {
        const declarative = new Set(declarativeMcpServers(this.ctx).map(server => server.serverName))
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
    const supervisor = new McpServerSupervisor(this.ctx)
    supervisor.sync(scope.get())
    this.ctx.effect(() => trackSupervisor(this.ctx, supervisor), 'mcp-manager: supervisor registry')
    this.ctx.effect(() => () => supervisor.dispose(), 'mcp-manager: roster teardown')
    this.ctx.effect(() => scope.watch((next) => { supervisor.sync(next) }), 'mcp-manager: settings watch')
  }

  /**
   * Merge the settings-managed roster with declarative Loader entries on every
   * call; neither side is cached, so the snapshot never goes stale. Rows never
   * carry secret config fields (`env`, `headers`).
   *
   * `status` reports mount lifecycle only: `ready` means the mcp-client fiber
   * settled its activation, not that the server is reachable — with
   * `failOnStartupError: false` an unreachable server reports `ready` while it
   * keeps reconnecting. Disabled settings rows and declarative rows report
   * null. When no supervisor is registered for this app (the manager never
   * mounted), settings rows are simply absent.
   * @returns current MCP server rows, settings entries first.
   */
  @Remote('list')
  list(): McpServerSnapshot {
    const entries: McpServerListEntry[] = []
    const supervisor = supervisorFor(this.ctx)
    const states = new Map(supervisor?.list().map(state => [state.serverName, state]))
    for (const [serverName, entry] of Object.entries(supervisor?.currentSection() ?? {})) {
      const state = states.get(serverName)
      entries.push({
        serverName,
        transport: entry.transport,
        source: 'settings',
        enabled: entry.enabled,
        // An enabled entry whose mount is still queued behind the serial
        // reconciler has no state row yet; its fiber is by definition unsettled.
        status: entry.enabled ? state?.status ?? 'connecting' : null,
        ...(state?.error === undefined ? {} : { error: state.error }),
      })
    }
    for (const server of declarativeMcpServers(this.ctx)) {
      entries.push({
        serverName: server.serverName,
        transport: server.transport,
        source: 'declarative',
        enabled: server.enabled,
        status: null,
      })
    }
    return { entries }
  }
}

export default McpServersGateway
