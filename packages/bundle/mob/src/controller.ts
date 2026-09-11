/** The `mob` Remote namespace: hands an authenticated Web client the phone-join URL. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { WebRuntimeValues } from '@deepseek-ai/dsh-web-app'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { resolveJoinUrl } from './join-url.ts'
import type {} from './types.ts'

/** Remote-only service composing the token-bearing LAN join URL for the settings dialog. */
export class MobJoinController extends TypertRemoteService {
  static inject = ['connection', 'webRuntime', 'webServer']

  constructor(ctx: Context) {
    super(ctx, 'mobJoin', { namespace: 'mob' })
  }

  /**
   * Compose the same join URL the terminal announcer prints, so the settings
   * dialog can render it as a QR code. The URL carries a fresh token; the
   * caller already holds the session cookie, which grants the same authority.
   * @returns the token-bearing LAN URL.
   * @throws RemoteError `mob/loopback-only` when the deployment binds loopback only.
   */
  @Remote
  joinUrl(): string {
    // webRuntime carries no Context merge; the inject declaration above
    // guarantees web-app provided it before this service activates.
    const webRuntime = this.ctx.get('webRuntime') as WebRuntimeValues
    const url = resolveJoinUrl(
      webRuntime.lanAddresses,
      this.ctx.webServer.port,
      baseUrl => this.ctx.connection.authenticatedUrl(baseUrl),
    )
    if (url === undefined) {
      throw new RemoteError('mob/loopback-only', 'loopback-only deployment has no LAN join URL', {})
    }
    return url
  }
}
