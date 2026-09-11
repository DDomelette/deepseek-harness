/**
 * Prints the authenticated LAN URL as a terminal QR code once the plugin tree
 * settles, so a phone on the same network joins by scanning. Loopback-only
 * and non-TTY deployments print nothing; the URL line itself is web-app's
 * readiness output.
 * @module @deepseek-ai/dsh-mob
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { resolveLanTrust } from '@deepseek-ai/dsh-web-app'
import qrcode from 'qrcode-terminal'

/** Stable Cordis plugin name. */
export const name = 'mob-quick-join'

/** The LAN URL needs the bound host and port. */
export const inject = ['webServer']

/** Roots that already printed; Connection hot reloads must not reprint. */
const ANNOUNCED_ROOTS = new Set<object>()

/**
 * Mount the QR announcer: waits for Loader settlement like web-app's
 * readiness row, then renders the token-bearing LAN URL.
 * @param ctx - plugin context carrying the webServer service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['connection'], (connectionCtx) => {
    const announce = (): void => {
      if (ANNOUNCED_ROOTS.has(connectionCtx.root)) return
      const lanCandidate = resolveLanTrust(connectionCtx.webServer.host, []).lanAddresses[0]
      if (lanCandidate === undefined || !process.stdout.isTTY) return
      ANNOUNCED_ROOTS.add(connectionCtx.root)
      const url = connectionCtx.connection.authenticatedUrl(`http://${lanCandidate}:${String(connectionCtx.webServer.port)}`)
      console.log(`dsh mob: scan to join from this network: ${url}`)
      qrcode.generate(url, { small: true })
    }
    const settled = connectionCtx.get('loader')?.await()
    if (settled === undefined) announce()
    else {
      void settled.then(() => {
        if (connectionCtx.get('webServer') !== undefined
          && connectionCtx.get('connection') !== undefined) announce()
      }, () => {})
    }
  })
}
