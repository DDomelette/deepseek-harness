/**
 * The origin the pairing link is composed on: the deployment's advertised URL
 * or a declared trusted host, falling back to its concrete non-loopback bind.
 * It carries no process token; a phone joins by pairing.
 */

import { isIP } from 'node:net'
import ipaddr from 'ipaddr.js'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'

/**
 * Compose the origin a pairing link is built from.
 * @param publicUrl - the deployment's advertised URL (`--public-url`), preferred when set.
 * @param trustedHosts - authorities the deployment declares (`--trusted-host`), in argument order.
 * @param listener - the active listener's address, port, and transport.
 * @returns the pairing root, or undefined without an advertised or non-loopback address.
 */
export function resolveJoinUrl(
  publicUrl: string | undefined,
  trustedHosts: readonly string[],
  listener: Pick<WebServer, 'host' | 'port' | 'protocol'>,
): string | undefined {
  if (publicUrl !== undefined) return publicUrl.endsWith('/') ? publicUrl : `${publicUrl}/`
  const authority = trustedHosts[0]
  if (authority !== undefined) {
    // Parsing with a non-default scheme preserves an explicit :80 or :443.
    const url = new URL(`http://${authority}`)
    const port = new URL(`dsh://${authority}`).port || String(listener.port)
    url.protocol = listener.protocol
    url.port = port
    return url.href
  }
  const host = listener.host
  if (host.includes('%') || ipaddr.process(host).range() === 'loopback') return undefined
  return `${listener.protocol}//${isIP(host) === 6 ? `[${host}]` : host}:${String(listener.port)}/`
}
