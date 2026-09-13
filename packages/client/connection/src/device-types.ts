/**
 * Paired-device declarations shared by both compiler faces: the Host registry
 * (`devices.ts`) implements them, the shared RPC protocol references them, and
 * the Client face only ever names them.
 * @module @deepseek-ai/dsh-client-connection/src/device-types
 */

import type { PairedDeviceId } from './device-brand.ts'

/** One device approved through the pairing handshake. */
export interface PairedDevice {
  /** Opaque id minted at approval and carried by that device's cookie. */
  readonly id: PairedDeviceId
  /** Operator-visible label; the approve dialog prefills it and may edit it. */
  readonly label: string
  /** Epoch milliseconds of approval. */
  readonly registeredAt: number
  /** Epoch milliseconds of the last accepted request, written back with throttling. */
  readonly lastSeenAt: number
  /** Days this device's current window lasts, as the operator set it; absent on a legacy entry. */
  readonly lifetimeDays?: number
  /**
   * Epoch milliseconds this device's current window ends, written with
   * {@link PairedDevice.lifetimeDays}. Absent on a legacy entry, which keeps
   * running on the expiry its cookie payload carries.
   */
  readonly expiresAt?: number
}

/** Fields the approve dialog supplies for a newly paired device. */
export interface RegisterDeviceRequest {
  /** Operator-visible label, defaulted from the phone's user agent and editable before approval. */
  readonly label: string
}
