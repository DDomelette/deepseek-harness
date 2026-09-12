/**
 * The LAN origin the pairing link is composed on: web-app's fence snapshot plus
 * the bound port. It carries no process token — the computer's launch token is
 * exchanged on loopback only, and a phone joins by pairing.
 */

/**
 * Compose the LAN origin a pairing link is built from.
 * @param lanAddresses - webRuntime's resolveLanTrust snapshot (empty on a loopback-only bind).
 * @param port - the webServer's bound port.
 * @returns the LAN origin, or undefined when the snapshot has no LAN address.
 */
export function resolveJoinUrl(
  lanAddresses: readonly string[],
  port: number,
): string | undefined {
  const lanAddress = lanAddresses[0]
  if (lanAddress === undefined) return undefined
  return `http://${lanAddress}:${String(port)}/`
}
