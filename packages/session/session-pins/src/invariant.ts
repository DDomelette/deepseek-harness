/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-pins`.
 * @module @deepseek-ai/dsh-session-pins/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-pins'

/** Cordis companion plugin name. */
export const name = 'session-pins-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Every mutation commits through the domain write chain before publishing its snapshot. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
