/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-deletion`.
 * @module @deepseek-ai/dsh-session-deletion/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-deletion'

/** Cordis companion plugin name. */
export const name = 'session-deletion-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

const install: InvariantInstaller = Object.assign(
  (_ctx: Context, _fail: (message: string) => never) => {
    // No runtime invariant: service tests pin the orchestration contract,
    // while persistence owns the durable relationship.
  },
  { inject: ['sessionDeletion'] },
)

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
