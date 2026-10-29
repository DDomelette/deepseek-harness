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
  /**
   * Epoch milliseconds the device cookie this Host last handed to that phone
   * expires at, written when the cookie is minted and again whenever it is
   * renewed. Absent on an entry whose credential predates this field. The
   * Connect-phone panel reads it because the window above only records what the
   * operator asked for: an extension reaches the phone later, so the two can
   * differ until that phone makes its next request.
   */
  readonly credentialExpiresAt?: number
  /**
   * Epoch milliseconds this device was moved to the recycle bin; absent while
   * the device is active. A binned entry keeps its id and window but its cookie
   * stops authenticating, so a restore re-admits that cookie without a new
   * pairing handshake.
   */
  readonly revokedAt?: number
  /**
   * LAN MAC address resolved from the ARP table at approval, serving as the
   * device's hardware fingerprint. Absent when the lookup failed or the entry
   * predates MAC resolution.
   */
  readonly macAddress?: string
}

/** Fields the approve dialog supplies for a newly paired device. */
export interface RegisterDeviceRequest {
  /** Operator-visible label, defaulted from the phone's user agent and editable before approval. */
  readonly label: string
  /** MAC address resolved from the claiming phone's source address, when the ARP table knew it. */
  readonly macAddress?: string
}
