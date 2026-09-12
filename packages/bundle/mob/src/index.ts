/**
 * The host half of the phone-access layer: mounting it registers the `mob`
 * Remote namespace whose `joinUrl` method hands an authenticated client the
 * token-bearing LAN URL the settings entry renders. Serving on the LAN — and the
 * `--allow-lan` acknowledgement that permits it — belongs to `dsh-web-app`; this
 * plugin rebinds nothing and writes no terminal output.
 * @module @deepseek-ai/dsh-mob
 */

import type { Context } from '@deepseek-ai/cordis'
import { MobJoinController } from './controller.ts'

export { MobJoinController } from './controller.ts'

/** Stable Cordis plugin name. */
export const name = 'mob-join'

/**
 * Mount the Remote namespace the settings entry reads.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(MobJoinController)
}
