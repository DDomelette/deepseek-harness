/**
 * The host half of the phone-access layer: mounting it registers the `mob`
 * Remote namespace whose `joinUrl` method hands an authenticated client the
 * token-bearing LAN URL the settings entry renders, and the `/pair*` routes
 * that pair a phone through a one-time code. Serving on the LAN — and the
 * `--allow-lan` acknowledgement that permits it — belongs to `dsh-web-app`; this
 * plugin rebinds nothing and writes no terminal output.
 * @module @deepseek-ai/dsh-mob
 */

import type { Context } from '@deepseek-ai/cordis'
import { MobJoinController } from './controller.ts'
import { PairingSessions } from './pairing.ts'
import { registerPairingRoutes } from './routes.ts'

export { MobJoinController } from './controller.ts'
export { PairingSessions } from './pairing.ts'
export { PAIR_PATHS, registerPairingRoutes } from './routes.ts'

/** Stable Cordis plugin name. */
export const name = 'mob-join'

/** Services the Remote namespace and the pairing routes read. */
export const inject = ['webServer', 'connection']

/**
 * Mount the Remote namespace the settings entry reads and the pairing routes
 * the phone handshake uses.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(MobJoinController)
  const pairing = new PairingSessions()
  ctx.effect(() => registerPairingRoutes(ctx, pairing))
}
