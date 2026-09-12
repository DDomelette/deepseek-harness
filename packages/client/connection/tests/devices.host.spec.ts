/** Paired-device registry reads: the stored record format and its failure modes. */

import { describe, expect, it } from 'vitest'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { PAIRED_DEVICES_RECORD_KEY, readPairedDevices } from '../src/devices.ts'
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

describe('readPairedDevices', () => {
  it('reads the registered devices in stored order', async () => {
    const store = new RecordCredentials()
    const second = { ...device, id: 'dev-2', label: 'iPad' }
    store.setPairedDevices({ version: 1, devices: [device, second] })

    await expect(readPairedDevices(credentials(store))).resolves.toEqual([device, second])
    expect(store).toMatchObject({ reads: 1, modifies: 0 })
    expect(String(PAIRED_DEVICES_KEY)).toBe(String(PAIRED_DEVICES_RECORD_KEY))
  })

  it('treats a missing record as no paired devices', async () => {
    await expect(readPairedDevices(credentials(new RecordCredentials()))).resolves.toEqual([])
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
      await expect(readPairedDevices(credentials(store))).rejects.toThrow(/paired-devices/u)
    }

    const wrongKind = new RecordCredentials()
    wrongKind.keyed.set(String(PAIRED_DEVICES_RECORD_KEY), { kind: 'api-key', key: 'not-a-registry' })
    await expect(readPairedDevices(credentials(wrongKind))).rejects.toThrow(/paired-devices/u)
  })
})
