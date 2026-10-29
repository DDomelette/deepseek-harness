/**
 * The origin the pairing link is composed on: the deployment's advertised URL
 * or one of its declared trusted hosts, plus the bound port. It carries no
 * process token — the computer's launch token is exchanged on loopback only,
 * and a phone joins by pairing.
 */

/**
 * Compose the origin a pairing link is built from.
 * @param publicUrl - the deployment's advertised URL (`--public-url`), preferred when set.
 * @param trustedHosts - authorities the deployment declares (`--trusted-host`), in argument order.
 * @param port - the webServer's bound port.
 * @returns the pairing origin, or undefined when the deployment declared neither.
 */
export function resolveJoinUrl(
  publicUrl: string | undefined,
  trustedHosts: readonly string[],
  port: number,
): string | undefined {
  if (publicUrl !== undefined) return publicUrl.endsWith('/') ? publicUrl : `${publicUrl}/`
  const host = trustedHosts[0]
  if (host === undefined) return undefined
  return `http://${host}:${String(port)}/`
}
