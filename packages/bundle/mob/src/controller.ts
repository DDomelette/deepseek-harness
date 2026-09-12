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

/** The webserver schema's all-interfaces bind literal — the only non-loopback host it admits. */
const ALL_INTERFACES_HOST = '0.0.0.0'

/** Remote-only service composing the LAN origin the settings panel builds a pairing link on. */
export class MobJoinController extends TypertRemoteService {
  static inject = ['webRuntime', 'webServer']

  constructor(ctx: Context) {
    super(ctx, 'mobJoin', { namespace: 'mob' })
  }

  /**
   * Compose the LAN origin the settings panel builds a pairing link on, from the
   * same fence snapshot `dsh web` prints. The value carries no process token: a
   * phone joins that deployment by claiming a pairing code.
   * @returns the LAN origin.
   * @throws RemoteError `mob/loopback-only` on a loopback bind, or `mob/no-lan-address`
   * when an all-interfaces bind derived no reachable address.
   */
  @Remote
  joinUrl(): string {
    // webRuntime carries no Context merge; the inject declaration above
    // guarantees web-app provided it before this service activates.
    const webRuntime = this.ctx.get('webRuntime') as WebRuntimeValues
    const url = resolveJoinUrl(webRuntime.lanAddresses, this.ctx.webServer.port)
    if (url === undefined) {
      // The two empty-snapshot causes need different corrections: starting the
      // mobile profile, or fixing this machine's networking.
      throw this.ctx.webServer.host === ALL_INTERFACES_HOST
        ? new RemoteError('mob/no-lan-address', 'no interface yielded a LAN address for the join URL', {})
        : new RemoteError('mob/loopback-only', 'loopback-only deployment has no LAN join URL', {})
    }
    return url
  }
}
