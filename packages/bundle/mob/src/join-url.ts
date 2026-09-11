/** The phone-join URL shared by the terminal announcer and the `mob` Remote method. */

/**
 * Compose the token-bearing LAN URL a phone scans, from web-app's fence
 * snapshot, the bound port, and Connection's token exchange.
 * @param lanAddresses - webRuntime's resolveLanTrust snapshot (empty on a loopback-only bind).
 * @param port - the webServer's bound port.
 * @param authenticatedUrl - Connection's token-bearing URL builder.
 * @returns the join URL, or undefined when the snapshot has no LAN address.
 */
export function resolveJoinUrl(
  lanAddresses: readonly string[],
  port: number,
  authenticatedUrl: (baseUrl: string) => string,
): string | undefined {
  const lanAddress = lanAddresses[0]
  if (lanAddress === undefined) return undefined
  return authenticatedUrl(`http://${lanAddress}:${String(port)}`)
}
