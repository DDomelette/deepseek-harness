/** Paired-device registry reads and writes: the stored record format and its failure modes. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import {
  PAIRED_DEVICES_RECORD_KEY, listDevices, registerDevice, revokeDevice, touchDevice,
} from '../src/devices.ts'
import { PAIRED_DEVICES_KEY, RecordCredentials } from './browser-credentials.ts'

function credentials(store: RecordCredentials): CredentialProvider {
  return store as unknown as CredentialProvider
}

const device = {
  id: 'dev-1',
  label: 'HUAWEI JAD-AL50',
  registeredAt: 1_700_000_000_000,
  lastSeenAt: 1_700_000_000_000,
}

afterEach(() => {
  vi.useRealTimers()
})

describe('listDevices', () => {
  it('reads the registered devices in stored order', async () => {
    const store = new RecordCredentials()
    const second = { ...device, id: 'dev-2', label: 'iPad' }
    store.setPairedDevices({ version: 1, devices: [device, second] })

    await expect(listDevices(credentials(store))).resolves.toEqual([device, second])
    expect(store).toMatchObject({ reads: 1, modifies: 0, writes: 0 })
    expect(String(PAIRED_DEVICES_KEY)).toBe(String(PAIRED_DEVICES_RECORD_KEY))
  })

  it('treats a missing record as no paired devices', async () => {
    await expect(listDevices(credentials(new RecordCredentials()))).resolves.toEqual([])
  })

  it('fails loud on a record it cannot interpret', async () => {
    const payloads: unknown[] = [
      { version: 2, devices: [] },
      { version: 1, devices: 'none' },
      { version: 1, devices: [42] },
      { version: 1, devices: [{ ...device, id: '' }] },
      { version: 1, devices: [{ ...device, id: 7 }] },
      { version: 1, devices: [{ ...device, label: 7 }] },
      { version: 1, devices: [{ ...device, registeredAt: 'then' }] },
      { version: 1, devices: [{ ...device, lastSeenAt: 'later' }] },
      { version: 1 },
      null,
    ]
    for (const payload of payloads) {
      const store = new RecordCredentials()
      store.setPairedDevices(payload)
      await expect(listDevices(credentials(store))).rejects.toThrow(/paired-devices/u)
    }

    const wrongKind = new RecordCredentials()
    wrongKind.keyed.set(String(PAIRED_DEVICES_RECORD_KEY), { kind: 'api-key', key: 'not-a-registry' })
    await expect(listDevices(credentials(wrongKind))).rejects.toThrow(/paired-devices/u)
  })
})

describe('paired-device registry writes', () => {
  it('registers a labelled device with a fresh id and lists it in registration order', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T10:00:00.000Z'))
    const store = new RecordCredentials()

    const first = await registerDevice(credentials(store), { label: 'HUAWEI JAD-AL50' })
    vi.setSystemTime(new Date('2026-09-12T10:05:00.000Z'))
    const second = await registerDevice(credentials(store), { label: 'iPad' })

    expect(first).toEqual({
      id: first.id,
      label: 'HUAWEI JAD-AL50',
      registeredAt: Date.parse('2026-09-12T10:00:00.000Z'),
      lastSeenAt: Date.parse('2026-09-12T10:00:00.000Z'),
    })
    expect(first.id).not.toBe(second.id)
    expect(first.id.length).toBeGreaterThanOrEqual(20)
    await expect(listDevices(credentials(store))).resolves.toEqual([first, second])
    expect(store).toMatchObject({ modifies: 2, reads: 1, writes: 2 })
  })

  it('revokes a registered device and reports whether it removed one', async () => {
    const store = new RecordCredentials()
    store.setPairedDevices({ version: 1, devices: [device] })

    await expect(revokeDevice(credentials(store), 'dev-1')).resolves.toBe(true)
    await expect(listDevices(credentials(store))).resolves.toEqual([])
    expect(store.keyed.get(String(PAIRED_DEVICES_KEY))).toEqual({
      kind: 'grant',
      payload: { version: 1, devices: [] },
    })
    expect(store).toMatchObject({ writes: 1 })

    await expect(revokeDevice(credentials(store), 'dev-1')).resolves.toBe(false)
    expect(store).toMatchObject({ writes: 1 })
  })

  it('writes the last-seen time only outside the one-hour throttle window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T12:00:00.000Z'))
    const store = new RecordCredentials()
    store.setPairedDevices({ version: 1, devices: [device, { ...device, id: 'dev-2', label: 'iPad' }] })
    const provider = credentials(store)

    await expect(touchDevice(provider, 'dev-1')).resolves.toBe(true)
    expect(store).toMatchObject({ writes: 1 })
    const touched = await listDevices(provider)
    expect(touched[0]?.lastSeenAt).toBe(Date.parse('2026-09-12T12:00:00.000Z'))
    expect(touched[1]?.lastSeenAt).toBe(device.lastSeenAt)

    vi.setSystemTime(new Date('2026-09-12T12:59:59.000Z'))
    await expect(touchDevice(provider, 'dev-1')).resolves.toBe(false)
    expect(store).toMatchObject({ writes: 1 })

    vi.setSystemTime(new Date('2026-09-12T13:00:01.000Z'))
    await expect(touchDevice(provider, 'dev-1')).resolves.toBe(true)
    expect(store).toMatchObject({ writes: 2 })
    await expect(touchDevice(provider, 'ghost')).resolves.toBe(false)
    expect(store).toMatchObject({ writes: 2 })
  })

  it('fails loud instead of overwriting a registry it cannot read', async () => {
    const store = new RecordCredentials()
    store.setPairedDevices({ version: 9, devices: [] })
    const provider = credentials(store)

    await expect(registerDevice(provider, { label: 'phone' })).rejects.toThrow(/paired-devices/u)
    await expect(revokeDevice(provider, 'dev-1')).rejects.toThrow(/paired-devices/u)
    await expect(touchDevice(provider, 'dev-1')).rejects.toThrow(/paired-devices/u)
    expect(store.keyed.get(String(PAIRED_DEVICES_KEY))).toEqual({
      kind: 'grant',
      payload: { version: 9, devices: [] },
    })
  })
})
