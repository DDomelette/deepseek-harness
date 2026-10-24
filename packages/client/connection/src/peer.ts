/**
 * Registration scope of one caller Connection admitted: the local operator, or
 * one paired device. The instance is its own scope key, so `scopeOf(peer.ctx)`
 * returns it and a dispatch scoped to this Peer reaches the listeners
 * registered through `peer.ctx` and nobody else.
 *
 * Authority is not recorded here. What a caller may do stays with the credential
 * that admitted the request — `isLocalOperatorRequest` for the operator, the
 * paired-device registry for a device — so giving two callers one Peer is what
 * widens one of them; the absence of a flag on this object cannot.
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { PeerId, PeerScope } from '@deepseek-ai/dsh-typert-protocol'

/** One caller's registration scope, owned by the Connection that admitted it. */
export class ConnectionPeer implements PeerScope {
  /** Identity the caller's listener routing and dispatches are bound to. */
  readonly id: PeerId = randomUUID() as PeerId
  /** Context through which the caller's registrations are made. */
  readonly ctx: Context
  private readonly scope: Scope

  /**
   * Mint one caller's scope.
   * @param owner - Connection context the scope fiber hangs under.
   */
  constructor(owner: Context) {
    this.scope = createScope(owner, this)
    this.ctx = this.scope.ctx
  }

  /**
   * Tear down every registration made through {@link ctx}; racing calls share
   * one completion.
   * @returns resolves once the scope has quiesced.
   */
  dispose(): Promise<void> {
    return this.scope.dispose()
  }
}
