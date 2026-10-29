/**
 * Browser-safe, zero-dependency loopback classification shared by the `/api`
 * Host fence and the package's `ctx.connection` state. The predicate stays
 * package-internal; client plugins consume the derived state through Cordis.
 */

/**
 * IPv4 address an IPv4-mapped IPv6 literal carries.
 * @param hostname - WHATWG URL hostname, brackets retained for IPv6 literals.
 * @returns the dotted IPv4 address, or undefined for any other hostname.
 */
function mappedIpv4(hostname: string): string | undefined {
  if (!hostname.startsWith('[') || !hostname.endsWith(']')) return undefined
  const literal = hostname.slice(1, -1).toLowerCase()
  if (!literal.startsWith('::ffff:')) return undefined
  const tail = literal.slice('::ffff:'.length)
  // The dotted form is already an IPv4 address (`[::ffff:127.0.0.1]`).
  if (tail.includes('.')) return tail
  const groups = tail.split(':')
  const [high, low] = groups
  if (groups.length !== 2 || high === undefined || low === undefined) return undefined
  if (!/^[0-9a-f]{1,4}$/.test(high) || !/^[0-9a-f]{1,4}$/.test(low)) return undefined
  // Each group is one 16-bit half of the mapped address, so both pad to four
  // digits before they form the 32-bit value.
  const value = Number.parseInt(high.padStart(4, '0') + low.padStart(4, '0'), 16)
  return [24, 16, 8, 0].map(shift => String((value >>> shift) & 0xff)).join('.')
}

/**
 * Whether a normalized URL hostname names the local loopback authority. A
 * trailing dot is the absolute form of the same name (`localhost.`), and an
 * IPv4-mapped IPv6 literal (`[::ffff:127.0.0.1]`) names the IPv4 address it
 * carries, which is what a dual-stack listener reports for a v4 loopback peer.
 * @param hostname - WHATWG URL hostname (IPv6 literals retain brackets).
 * @returns true for localhost, IPv6 loopback, or any IPv4 address in 127/8.
 */
export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname
  if (normalized === 'localhost' || normalized === '[::1]') return true
  const address = mappedIpv4(normalized) ?? normalized
  const parts = address.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}
