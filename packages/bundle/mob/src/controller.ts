/** The `mob` Remote namespace: hands an authenticated Web client the phone-join URL. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { WebStartupValues } from '@deepseek-ai/dsh-web-app/startup'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { resolveJoinUrl } from './join-url.ts'
import type {} from './types.ts'

/** Remote-only service composing the origin the settings panel builds a pairing link on. */
export class MobJoinController extends TypertRemoteService {
  static inject = ['webStartup', 'webServer']

  constructor(ctx: Context) {
    super(ctx, 'mobJoin', { namespace: 'mob' })
  }

  /**
   * Compose the origin the settings panel builds a pairing link on, from the
   * deployment's own advertisement: its `--public-url` when set, otherwise its
   * first declared `--trusted-host`. The value carries no process token: a
   * phone joins that deployment by claiming a pairing code.
   * @returns the pairing origin.
   * @throws RemoteError `mob/no-advertised-origin` when the deployment declared
   * neither an advertised URL nor a trusted host.
   */
  @Remote
  joinUrl(): string {
    // webStartup carries no Context merge; the inject declaration above
    // guarantees web-app provided it before this service activates.
    const startup = this.ctx.get('webStartup') as WebStartupValues
    const url = resolveJoinUrl(startup.publicUrl, startup.trustedHosts, this.ctx.webServer.port)
    if (url === undefined) {
      throw new RemoteError(
        'mob/no-advertised-origin',
        'the deployment declares no --public-url and no --trusted-host, so no phone-reachable origin exists',
        {},
      )
    }
    return url
  }
}
