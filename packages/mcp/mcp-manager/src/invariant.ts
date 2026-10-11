/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-mcp-manager`.
 * @module @deepseek-ai/dsh-mcp-manager/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { declarativeMcpServers } from './declarative.ts'
import { supervisorFor } from './supervisor.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-mcp-manager'

/** Cordis companion plugin name. */
export const name = 'mcp-manager-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['loader']

/**
 * Install the roster non-intersection contract: the `mcp-servers` section the
 * manager reconciled never names a cordis.yml-declared server. An edit to the
 * running manager is refused before it is persisted, so this companion covers
 * the section a composition already stored when the owner mounted — the one
 * case the write path deliberately leaves alone.
 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const check = (): void => {
    const section = supervisorFor(ctx)?.currentSection() ?? {}
    const declarative = new Set(declarativeMcpServers(ctx).map(server => server.serverName))
    for (const key of Object.keys(section)) {
      if (declarative.has(key)) {
        fail(`mcp-servers entry "${key}" collides with the cordis.yml-declared server of the same name`)
      }
    }
  }
  check()
  // The supervisor's own roster invalidation is the one signal that a section
  // became current, whether it was committed live or read at activation.
  ctx.on('mcp-servers/change', check)
}, { inject: ['loader'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
