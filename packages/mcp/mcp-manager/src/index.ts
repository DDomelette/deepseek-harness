/**
 * MCP server manager: declares the `mcp-servers` settings section, hot-mounts
 * one dsh-mcp-client instance per enabled entry, and projects declarative
 * (cordis.yml) servers read-only alongside them. The default export is the
 * plugin the Loader mounts: the `mcpServers` Remote gateway, whose lifecycle
 * owns the section schema and the supervisor.
 *
 * @module @deepseek-ai/dsh-mcp-manager
 */

import { FiberState, Service, type Context, type Fiber } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { declarativeMcpServers } from './declarative.ts'
import { McpServersSchema } from './schema.ts'
import type { McpServersConfig, McpServersSnapshot } from './schema.ts'
import { McpServerSupervisor, supervisorFor, trackSupervisor } from './supervisor.ts'
import type { McpServerListEntry, McpServerSnapshot } from './types.ts'

export * from './schema.ts'
export * from './declarative.ts'
export * from './supervisor.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Volatile config values were committed into the running fiber without a
     * remount. Declared here because the vendored Loader of this tree predates
     * the volatile-config-reference feature and does not publish it yet; a
     * Loader that declares it merges as an identical overload.
     * @mode emit
     * @param paths - changed paths, each an array of object keys.
     */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}

/**
 * Refuse a live roster that names a server the composition already declares.
 * The declarative roster is a composition fact no schema can see, so the check
 * runs where the candidate config is validated: a settings write fails before
 * it is persisted, and the stored-section case stays with the package
 * invariant.
 * @param ctx - Host context carrying the Loader roster.
 * @param roster - candidate roster read from this plugin's own Config.
 * @throws Error naming the colliding serverName.
 */
function assertNoDeclarativeCollision(ctx: Context, roster: McpServersSnapshot): void {
  const declarative = new Set(declarativeMcpServers(ctx).map(server => server.serverName))
  for (const key of Object.keys(roster)) {
    if (declarative.has(key)) {
      throw new Error(`mcp-servers: serverName "${key}" is already declared in cordis.yml — pick a unique name`)
    }
  }
}

/**
 * Manager plugin and read-only Remote over the MCP server roster. The Loader
 * mounts this class (the package's default export), so one cordis.yml row
 * composes the whole feature: the `mcp-servers` section schema, the hot-mount
 * supervisor, and the `mcpServers` Remote face.
 *
 * The roster projection covers exactly two planes: the settings-managed
 * entries the supervisor owns, and mcp-client entries declared in cordis.yml.
 * MCP servers an agent preset mounts inline never appear in
 * `ctx.loader.entries()` (packages/preset/agent-presets/README.md), so they
 * are absent here by design — a preset composes one session, while this
 * Remote answers for the host.
 */
export class McpServersGateway extends TypertRemoteService {
  static inject = ['loader']
  /** The section itself: the `servers` roster the settings page edits. */
  static Config = McpServersSchema

  /**
   * @param ctx - host context carrying the loader service.
   * @param config - the live `mcp-servers` section; its `servers` reference is retained for the instance's lifetime.
   */
  constructor(ctx: Context, private readonly config: McpServersConfig) {
    super(ctx, 'mcpServers')
    ctx.inject(['settings'], (child) => {
      // The Web MCP tab is this section's page; no generic form is generated.
      child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
    })
  }

  /**
   * Mount the supervisor on the current section, keep the roster reconciled on
   * every later commit, and refuse a write that names a cordis.yml-declared
   * server. Effects dispose in reverse registration order, so the watch
   * detaches before the roster tears down and the supervisor stays published
   * until teardown finished.
   */
  protected [Service.init](): void {
    const ctx = this.ctx
    const supervisor = new McpServerSupervisor(ctx)
    supervisor.sync(this.section())
    ctx.effect(() => trackSupervisor(ctx, supervisor), 'mcp-manager: supervisor registry')
    ctx.effect(() => () => supervisor.dispose(), 'mcp-manager: roster teardown')
    // A volatile-only commit updates the running section reference in place, so
    // the roster is reconciled from the commit notification; every other change
    // restarts this fiber and reconciles again through this method.
    ctx.on('loader/volatile-update', () => { supervisor.sync(this.section()) })
    ctx.on('internal/config', function (this: Fiber, _raw, next) {
      const raw: unknown = next()
      // Activation accepts whatever the composition stores — a section that
      // predates this owner is the package invariant's case. An edit to the
      // running instance is the settings seam's write, and that is refused.
      if (this !== ctx.fiber || this.state !== FiberState.ACTIVE) return raw
      assertNoDeclarativeCollision(ctx, McpServersSchema(raw as McpServersConfig).servers.get())
      return raw
    })
  }

  /** Current roster, or an empty one before the first commit. */
  private section(): McpServersSnapshot {
    return this.config.servers.get()
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
