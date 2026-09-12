/**
 * Paired-device registry: the credential record naming the phones approved
 * through the pairing handshake. The record is the authority for device-cookie
 * validity, so a revoked device loses access on the next read.
 * @module @deepseek-ai/dsh-client-connection/src/devices
 */

import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'

/** Credentials record holding the approved devices. */
export const PAIRED_DEVICES_RECORD_KEY = credentialKey('client-connection', 'paired-devices')

const PAIRED_DEVICES_VERSION = 1

/** One device approved through the pairing handshake. */
export interface PairedDevice {
  /** Opaque id minted at approval and carried by that device's cookie. */
  readonly id: string
  /** Operator-visible label; the approve dialog prefills it and may edit it. */
  readonly label: string
  /** Epoch milliseconds of approval. */
  readonly registeredAt: number
  /** Epoch milliseconds of the last accepted request, written back with throttling. */
  readonly lastSeenAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function malformed(detail: string): Error {
  return new Error(`client-connection: paired-devices credential record ${detail}`)
}

function deviceOf(value: unknown): PairedDevice {
  if (!isRecord(value)) throw malformed('has a non-object entry')
  const { id, label, registeredAt, lastSeenAt } = value
  if (typeof id !== 'string' || id === '') throw malformed('has an entry without an id')
  if (typeof label !== 'string') throw malformed(`entry ${id} has a non-string label`)
  if (!Number.isSafeInteger(registeredAt)) throw malformed(`entry ${id} has an invalid registration time`)
  if (!Number.isSafeInteger(lastSeenAt)) throw malformed(`entry ${id} has an invalid last-seen time`)
  return { id, label, registeredAt: registeredAt as number, lastSeenAt: lastSeenAt as number }
}

/**
 * Read the approved devices from the credential provider.
 * @param credentials - persistent credential provider for the Web profile.
 * @returns the stored devices in stored order, or an empty list when no record exists.
 */
export async function readPairedDevices(credentials: CredentialProvider): Promise<readonly PairedDevice[]> {
  const record = await credentials.readRecord(PAIRED_DEVICES_RECORD_KEY)
  if (record === undefined) return []
  if (record.kind !== 'grant' || !isRecord(record.payload)
    || record.payload.version !== PAIRED_DEVICES_VERSION
    || !Array.isArray(record.payload.devices)) {
    throw malformed('has an unsupported format')
  }
  return record.payload.devices.map(deviceOf)
}
