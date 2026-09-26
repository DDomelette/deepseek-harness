/**
 * Paired-device registry: the credential record naming the phones approved
 * through the pairing handshake. The record is the authority for device-cookie
 * validity: revocation moves a device to the recycle bin, where its cookie
 * loses access on the next read while the entry stays restorable; only a
 * binned device can be purged for good. Every write goes through
 * {@link CredentialProvider.modifyRecord} so concurrent writers cannot drop
 * each other's devices.
 * @module @deepseek-ai/dsh-client-connection/src/devices
 */

import { randomBytes } from 'node:crypto'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { PairedDeviceId } from './device-brand.ts'
import type { PairedDevice, RegisterDeviceRequest } from './device-types.ts'

export type { PairedDevice, RegisterDeviceRequest } from './device-types.ts'

/** Credentials record holding the approved devices. */
export const PAIRED_DEVICES_RECORD_KEY = credentialKey('client-connection', 'paired-devices')

const PAIRED_DEVICES_VERSION = 1
const DEVICE_ID_BYTES = 16
const TOUCH_THROTTLE_MILLISECONDS = 60 * 60 * 1000
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function malformed(detail: string): Error {
  return new Error(`client-connection: paired-devices credential record ${detail}`)
}

/** Stored MAC shape: six colon-separated octets, lowercase. */
const MAC_PATTERN = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/u

function deviceOf(value: unknown): PairedDevice {
  if (!isRecord(value)) throw malformed('has a non-object entry')
  const { id, label, registeredAt, lastSeenAt, lifetimeDays, expiresAt, revokedAt, macAddress } = value
  if (typeof id !== 'string' || id === '') throw malformed('has an entry without an id')
  if (typeof label !== 'string') throw malformed(`entry ${id} has a non-string label`)
  if (!Number.isSafeInteger(registeredAt)) throw malformed(`entry ${id} has an invalid registration time`)
  if (!Number.isSafeInteger(lastSeenAt)) throw malformed(`entry ${id} has an invalid last-seen time`)
  // The stored window is record integrity, not policy: the 1–365 day range is
  // enforced where an operator value enters, in the config schema and the route.
  if (lifetimeDays !== undefined && !(Number.isSafeInteger(lifetimeDays) && (lifetimeDays as number) >= 1)) {
    throw malformed(`entry ${id} has an invalid lifetime`)
  }
  if (expiresAt !== undefined && !Number.isSafeInteger(expiresAt)) {
    throw malformed(`entry ${id} has an invalid expiry`)
  }
  if (revokedAt !== undefined && !Number.isSafeInteger(revokedAt)) {
    throw malformed(`entry ${id} has an invalid revocation time`)
  }
  if (macAddress !== undefined && (typeof macAddress !== 'string' || !MAC_PATTERN.test(macAddress))) {
    throw malformed(`entry ${id} has an invalid MAC address`)
  }
  const device: PairedDevice = {
    id: PairedDeviceId(id),
    label,
    registeredAt: registeredAt as number,
    lastSeenAt: lastSeenAt as number,
  }
  return {
    ...device,
    ...lifetimeDays === undefined ? {} : { lifetimeDays: lifetimeDays as number },
    ...expiresAt === undefined ? {} : { expiresAt: expiresAt as number },
    ...revokedAt === undefined ? {} : { revokedAt: revokedAt as number },
    ...macAddress === undefined ? {} : { macAddress },
  }
}

/** Parse one stored record, failing loud on anything this build cannot interpret. */
function devicesOf(record: CredentialRecord | undefined): readonly PairedDevice[] {
  if (record === undefined) return []
  if (record.kind !== 'grant' || !isRecord(record.payload)
    || record.payload.version !== PAIRED_DEVICES_VERSION
    || !Array.isArray(record.payload.devices)) {
    throw malformed('has an unsupported format')
  }
  return record.payload.devices.map(deviceOf)
}

/** The record a write stores for a complete device list. */
function registryRecord(devices: readonly PairedDevice[]): CredentialRecord {
  return { kind: 'grant', payload: { version: PAIRED_DEVICES_VERSION, devices } }
}

/**
 * Read-modify-write the registry. The mutate callback returns the complete next
 * list, or `undefined` to leave the stored record untouched.
 * @param credentials - persistent credential provider for the Web profile.
 * @param mutate - transition from the stored list to the list to store.
 * @returns nothing after the provider settled the write.
 */
async function writeDevices(
  credentials: CredentialProvider,
  mutate: (devices: readonly PairedDevice[]) => readonly PairedDevice[] | undefined,
): Promise<void> {
  await credentials.modifyRecord(PAIRED_DEVICES_RECORD_KEY, (current) => {
    const next = mutate(devicesOf(current))
    return Promise.resolve(next === undefined ? undefined : registryRecord(next))
  })
}

/**
 * List the approved devices.
 * @param credentials - persistent credential provider for the Web profile.
 * @returns the stored devices in stored order, or an empty list when no record exists.
 */
export async function listDevices(credentials: CredentialProvider): Promise<readonly PairedDevice[]> {
  return devicesOf(await credentials.readRecord(PAIRED_DEVICES_RECORD_KEY))
}

/**
 * Register a newly approved device and mint its opaque id.
 * @param credentials - persistent credential provider for the Web profile.
 * @param request - the label the operator approved the device under, and the
 * MAC address the ARP table resolved for the claiming phone, when it did.
 * @param lifetimeDays - delivery window in days this device starts with.
 * @returns the stored device entry.
 */
export async function registerDevice(
  credentials: CredentialProvider,
  request: RegisterDeviceRequest,
  lifetimeDays: number,
): Promise<PairedDevice> {
  const now = Date.now()
  const device: PairedDevice = {
    id: PairedDeviceId(randomBytes(DEVICE_ID_BYTES).toString('base64url')),
    label: request.label,
    registeredAt: now,
    lastSeenAt: now,
    lifetimeDays,
    expiresAt: now + lifetimeDays * DAY_MILLISECONDS,
    ...request.macAddress === undefined ? {} : { macAddress: request.macAddress },
  }
  await writeDevices(credentials, devices => [...devices, device])
  return device
}

/**
 * Move one device to the recycle bin; its cookie stops authenticating on the
 * next read, while the entry keeps its id and window so {@link restoreDevice}
 * can re-admit it.
 * @param credentials - persistent credential provider for the Web profile.
 * @param deviceId - id of the device to bin.
 * @returns true when an active device was binned.
 */
export async function revokeDevice(
  credentials: CredentialProvider,
  deviceId: PairedDeviceId,
): Promise<boolean> {
  const devices = await listDevices(credentials)
  const target = devices.find(device => device.id === deviceId)
  if (target === undefined || target.revokedAt !== undefined) return false
  const revokedAt = Date.now()
  await writeDevices(credentials, current => current.map(device =>
    (device.id === deviceId ? { ...device, revokedAt } : device)))
  return true
}

/**
 * Find the binned entry one bin-only mutation targets.
 * @param credentials - persistent credential provider for the Web profile.
 * @param deviceId - id of the device to look up.
 * @returns the stored entry when it sits in the recycle bin, else undefined.
 */
async function binnedDevice(
  credentials: CredentialProvider,
  deviceId: PairedDeviceId,
): Promise<PairedDevice | undefined> {
  const target = (await listDevices(credentials)).find(device => device.id === deviceId)
  return target?.revokedAt === undefined ? undefined : target
}

/**
 * Restore one binned device; its cookie authenticates again while its window
 * is still open.
 * @param credentials - persistent credential provider for the Web profile.
 * @param deviceId - id of the device to restore.
 * @returns true when a binned device was restored.
 */
export async function restoreDevice(
  credentials: CredentialProvider,
  deviceId: PairedDeviceId,
): Promise<boolean> {
  const target = await binnedDevice(credentials, deviceId)
  if (target === undefined) return false
  await writeDevices(credentials, current => current.map((device) => {
    if (device.id !== deviceId) return device
    return {
      id: device.id,
      label: device.label,
      registeredAt: device.registeredAt,
      lastSeenAt: device.lastSeenAt,
      ...device.lifetimeDays === undefined ? {} : { lifetimeDays: device.lifetimeDays },
      ...device.expiresAt === undefined ? {} : { expiresAt: device.expiresAt },
      ...device.macAddress === undefined ? {} : { macAddress: device.macAddress },
    }
  }))
  return true
}

/**
 * Delete one device for good. Deletion is bin-only by design: an active device
 * must pass through {@link revokeDevice} before it can be purged.
 * @param credentials - persistent credential provider for the Web profile.
 * @param deviceId - id of the device to remove.
 * @returns true when a binned device was removed.
 */
export async function purgeDevice(
  credentials: CredentialProvider,
  deviceId: PairedDeviceId,
): Promise<boolean> {
  const target = await binnedDevice(credentials, deviceId)
  if (target === undefined) return false
  await writeDevices(credentials, current => current.filter(device => device.id !== deviceId))
  return true
}

/**
 * Rename one device; the label is operator-facing only, so an active or a
 * binned entry both accept it.
 * @param credentials - persistent credential provider for the Web profile.
 * @param deviceId - id of the device to rename.
 * @param label - the new operator-visible label, already validated at the route.
 * @returns true when a registered device was renamed.
 */
export async function renameDevice(
  credentials: CredentialProvider,
  deviceId: PairedDeviceId,
  label: string,
): Promise<boolean> {
  const devices = await listDevices(credentials)
  if (!devices.some(device => device.id === deviceId)) return false
  await writeDevices(credentials, current => current.map(device =>
    (device.id === deviceId ? { ...device, label } : device)))
  return true
}

/**
 * Set one device's delivery window, restarting its countdown: a shorter window
 * applies to that device's next request, a longer one on its next index request.
 * @param credentials - persistent credential provider for the Web profile.
 * @param deviceId - id of the device to re-schedule.
 * @param days - window in days, written together with the expiry it implies.
 * @returns true when a registered device was re-scheduled.
 */
export async function setDeviceLifetime(
  credentials: CredentialProvider,
  deviceId: PairedDeviceId,
  days: number,
): Promise<boolean> {
  const devices = await listDevices(credentials)
  if (!devices.some(device => device.id === deviceId)) return false
  const expiresAt = Date.now() + days * DAY_MILLISECONDS
  await writeDevices(credentials, current => current.map(device =>
    (device.id === deviceId ? { ...device, lifetimeDays: days, expiresAt } : device)))
  return true
}

/**
 * Record that a registered device just authenticated, at most once per hour so
 * ordinary requests do not rewrite the credential file.
 * @param credentials - persistent credential provider for the Web profile.
 * @param deviceId - id of the device that made the request.
 * @returns true when the stored last-seen time was advanced.
 */
export async function touchDevice(
  credentials: CredentialProvider,
  deviceId: PairedDeviceId,
): Promise<boolean> {
  const now = Date.now()
  let touched = false
  await writeDevices(credentials, (devices) => {
    const target = devices.find(device => device.id === deviceId)
    if (target === undefined || now - target.lastSeenAt < TOUCH_THROTTLE_MILLISECONDS) return undefined
    touched = true
    return devices.map(device => (device.id === deviceId ? { ...device, lastSeenAt: now } : device))
  })
  return touched
}
