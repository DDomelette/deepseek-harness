/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-settings-archived`.
 * @module @deepseek-ai/dsh-client-ui-settings-archived/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-settings-archived'

/** Cordis companion plugin name. */
export const name = 'client-ui-settings-archived-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the panel is browser state over typed RPC responses
 * and the settings seam owns the durable write relation it exercises; slot
 * conflicts fail loud in the slot core. Store and component tests cover the
 * page behavior.
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
