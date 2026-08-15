/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-reference-admission`.
 * @module @deepseek-ai/dsh-session-reference-admission/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-reference-admission'

/** Cordis companion plugin name. */
export const name = 'session-reference-admission-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: admission rewrites claimed pre-step messages before
 * they become durable; the real-loop integration test pins snapshot/direct
 * order, and `@deepseek-ai/dsh-session-reference` owns the snapshot shape.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
