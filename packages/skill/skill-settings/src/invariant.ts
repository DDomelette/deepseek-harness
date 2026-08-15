/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-skill-settings`.
 * @module @deepseek-ai/dsh-skill-settings/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-skill-settings'

/** Cordis companion plugin name. */
export const name = 'skill-settings-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this adapter owns no independent lifecycle stream; the
 * settings→registry override relation is asserted by the package's unit suite.
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
