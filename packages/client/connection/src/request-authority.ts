/**
 * Canonical request authority shared by browser authentication and the
 * loopback check the phone-pairing routes apply before they accept a decision.
 * @module @deepseek-ai/dsh-client-connection/src/request-authority
 */

import type { ConnectionTrustRequest } from './rpc.ts'

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
