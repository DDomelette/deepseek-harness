/**
 * The paired-device id and its brand constructor, shared by both compiler
 * faces: the Host registry mints and matches ids, the RPC protocol names them,
 * and the pairing routes carry them in JSON. A leaf module because the Client
 * face reaches the type without the Host registry.
 * @module @deepseek-ai/dsh-client-connection/src/device-brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Identifies one device approved through the pairing handshake. Branded so
 * revoke, touch, and cookie issuance cannot be handed a device label, a pairing
 * code, or any other unrelated string.
 */
export type PairedDeviceId = Branded<'PairedDeviceId'>

/**
 * Brand a string as a {@link PairedDeviceId}.
 * @param id - the stored id string.
 * @returns the same string, branded; no validation is performed.
 */
export function PairedDeviceId(id: string): PairedDeviceId {
  return id as PairedDeviceId
}
