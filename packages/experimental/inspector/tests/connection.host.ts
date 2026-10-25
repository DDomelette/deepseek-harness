/** Local-operator Connection for Inspector Worker and bootstrap tests. */
import type { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'

/**
 * Mount the real route registry for trusted in-process test calls.
 * @param ctx - Test lifetime owning the Connection and its operator Peer.
 * @returns Connection serving the Inspector bootstrap registration.
 */
export function provideInspectorConnection(ctx: Context): HostConnectionService {
  const auth: Pick<BrowserAuth, 'isAuthenticated'> = { isAuthenticated: () => true }
  return new HostConnectionService(ctx, [], auth as BrowserAuth, 1_048_576)
}
