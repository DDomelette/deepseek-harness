/** Projection of cordis.yml-declared mcp-client Loader entries. */

import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'

/** Module specifier of the mcp-client plugin, matched against `entry.options.name`. */
export const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/** Lifecycle phase of one declarative entry's root Fiber. */
export type DeclarativeFiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

/** Panel-visible projection of one cordis.yml-declared MCP server. */
export interface DeclarativeMcpServer {
  /** serverName read from the entry's plugin config. */
  readonly serverName: string
  /** Transport read from the entry's plugin config. */
  readonly transport: 'stdio' | 'streamable-http'
  /** Effective Loader enablement (`!entry.disabled`). */
  readonly enabled: boolean
  /** Root Fiber phase, or null when the entry has no live root Fiber. */
  readonly fiberPhase: DeclarativeFiberPhase
}

/* jscpd:ignore-start */
/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, DeclarativeFiberPhase>
/* jscpd:ignore-end */

/**
 * Project the Loader entries that mount dsh-mcp-client. Entries whose config
 * lacks a readable serverName/transport are skipped — a malformed declarative
 * entry fails at its own fiber load, not here.
 * @param ctx - host context carrying the loader service.
 * @returns declarative MCP servers in Loader order.
 */
export function declarativeMcpServers(ctx: Context): DeclarativeMcpServer[] {
  const result: DeclarativeMcpServer[] = []
  for (const entry of ctx.loader.entries()) {
    if (entry.options.group) continue
    if (entry.options.name !== MCP_CLIENT_MODULE) continue
    const config = entry.options.config as { serverName?: unknown; transport?: unknown } | undefined
    const serverName = config?.serverName
    const transport = config?.transport
    if (typeof serverName !== 'string') continue
    if (transport !== 'stdio' && transport !== 'streamable-http') continue
    result.push({
      serverName,
      transport,
      enabled: !entry.disabled,
      fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
    })
  }
  return result
}
