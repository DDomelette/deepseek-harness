/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-pinned-sessions`.
 * @module @deepseek-ai/dsh-client-ui-pinned-sessions/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-pinned-sessions'

/** Cordis companion plugin name. */
export const name = 'client-ui-pinned-sessions-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a pure-consumer plugin registering presentational
 * components into three workspace slots plus its locale dictionary — its
 * inject face is a Remote mirror with optimistic rollback; it emits no
 * cordis events and owns no cross-plugin mutable state.
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
