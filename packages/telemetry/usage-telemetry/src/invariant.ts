/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-usage-telemetry`.
 * @module @deepseek-ai/dsh-usage-telemetry/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-usage-telemetry'

/** Cordis companion plugin name. */
export const name = 'usage-telemetry-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: `llm/stream` is the capture point, but the package's
 * only result is an external JSONL append rather than a harness event stream or
 * mutable registry value. An independent companion therefore has no
 * authoritative in-process result to relate to the call. The row schema is
 * pinned by the frozen v1 {@link ./schema.ts} and its unit tests.
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
