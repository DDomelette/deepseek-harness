/**
 * Canonical request authority shared by browser authentication and the
 * loopback check the phone-pairing routes apply before they accept a decision.
 * @module @deepseek-ai/dsh-client-connection/src/request-authority
 */

import { BlockList, isIP } from 'node:net'
import type { ConnectionTrustRequest } from './rpc.ts'

const LOOPBACK_PEERS = new BlockList()
LOOPBACK_PEERS.addSubnet('127.0.0.0', 8, 'ipv4')
LOOPBACK_PEERS.addAddress('::1', 'ipv6')

/**
 * Check the server-observed TCP peer without trusting forwarding headers.
 * @param request - HTTP request carrying the socket's remote address.
 * @returns true for IPv4, IPv6, or IPv4-mapped loopback; false when the peer is absent.
 */
export function isLoopbackPeer(request: ConnectionTrustRequest): boolean {
  const address = request.socket?.remoteAddress
  if (address === undefined) return false
  const family = isIP(address)
  return family !== 0 && LOOPBACK_PEERS.check(address, family === 4 ? 'ipv4' : 'ipv6')
}

/**
 * Read one request header from either a Node-style bag or a `Headers` instance.
 * @param headers - request headers in either supported form.
 * @param name - lower-case header name.
 * @returns the header value, or undefined when the request does not carry it.
 */
export function header(
  headers: ConnectionTrustRequest['headers'],
  name: string,
): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * Canonical authority (`host:port`) a request was addressed to.
 * @param headers - request headers in either supported form.
 * @returns the normalized authority, or undefined when the request carries no usable Host.
 */
export function requestAuthority(headers: ConnectionTrustRequest['headers']): string | undefined {
  const host = header(headers, 'host')
  if (host === undefined) return undefined
  try {
    return new URL(`http://${host}`).host
  } catch {
    return undefined
  }
}

/**
 * WHATWG-normalized hostname a request was addressed to.
 * @param headers - request headers in either supported form.
 * @returns the normalized hostname, or undefined when the request carries no usable Host.
 */
export function requestHostname(headers: ConnectionTrustRequest['headers']): string | undefined {
  const host = header(headers, 'host')
  if (host === undefined) return undefined
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return undefined
  }
}
