/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-mcp-manager`.
 * @module @deepseek-ai/dsh-mcp-manager/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { declarativeMcpServers, MCP_SERVERS_NS } from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-mcp-manager'

/** Cordis companion plugin name. */
export const name = 'mcp-manager-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Install the roster non-intersection contract: a resolved `mcp-servers`
 * section never names a cordis.yml-declared server. The namespace
 * registration's `validate` refuses such writes; this companion proves the
 * relation still holds at every commit, including sections stored before the
 * owner mounted.
 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const check = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return
    const declarative = new Set(declarativeMcpServers(ctx).map(server => server.serverName))
    for (const key of Object.keys(value)) {
      if (declarative.has(key)) {
        fail(`mcp-servers entry "${key}" collides with the cordis.yml-declared server of the same name`)
      }
    }
  }
  const current = ctx.settings.get(settingsNamespace(MCP_SERVERS_NS))
  if (current !== undefined) check(current)
  ctx.on('settings/updated', (ns, next) => {
    if (ns !== settingsNamespace(MCP_SERVERS_NS)) return
    check(next)
  })
}, { inject: ['settings', 'loader'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
