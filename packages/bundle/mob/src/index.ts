/**
 * Prints the authenticated LAN URL as a terminal QR code once the plugin tree
 * settles, so a phone on the same network joins by scanning. The LAN address
 * is web-app's webRuntime snapshot — the same resolveLanTrust result that
 * feeds the /api trust fence — so the scanned URL always passes the fence.
 * Loopback-only and non-TTY deployments print nothing; the URL line itself
 * is web-app's readiness output.
 * @module @deepseek-ai/dsh-mob
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { WebRuntimeValues } from '@deepseek-ai/dsh-web-app'
import qrcode from 'qrcode-terminal'

/** Stable Cordis plugin name. */
export const name = 'mob-quick-join'

/** The LAN URL needs the bound port and web-app's fence LAN snapshot. */
export const inject = ['webServer', 'webRuntime']

/** Roots that already printed; Connection hot reloads must not reprint. */
const ANNOUNCED_ROOTS = new WeakSet<Context>()

/**
 * Mount the QR announcer: waits for Loader settlement like web-app's
 * readiness row, then renders the token-bearing LAN URL.
 * @param ctx - plugin context carrying the webServer and webRuntime services.
 */
export function apply(ctx: Context): void {
  ctx.inject(['connection', 'webRuntime'], (connectionCtx) => {
    const announce = (): void => {
      if (ANNOUNCED_ROOTS.has(connectionCtx.root)) return
      // Reuse the exact LAN snapshot provided to the /api trust fence.
      // webRuntime carries no Context merge; the inject declaration above
      // guarantees web-app provided it before this callback runs.
      const webRuntime = connectionCtx.get('webRuntime') as WebRuntimeValues
      const lanCandidate = webRuntime.lanAddresses[0]
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
          && connectionCtx.get('webRuntime') !== undefined
          && connectionCtx.get('connection') !== undefined) announce()
      }, () => {})
    }
  })
}
