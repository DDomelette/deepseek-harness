/**
 * The pairing routes' client half: request shapes, answer parsing, and the two
 * pure helpers the panel builds its view from.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPairingApi, deviceLabelFrom, pairingUrlOf } from '../src/client/pairing-api.ts'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function stub(response: Response | Error): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response
    return response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('pairing route client', () => {
  it('opens a request and reads its code', async () => {
    const fetchMock = stub(json({ code: 'ABCD2345', expiresAt: 1_700_000_000_000 }))

    await expect(createPairingApi().open()).resolves.toEqual({
      ok: true,
      value: { code: 'ABCD2345', expiresAt: 1_700_000_000_000 },
    })
    expect(fetchMock).toHaveBeenCalledWith('/pair/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
  })

  it('classifies refused and malformed answers', async () => {
    const api = createPairingApi()
    for (const [status, reason] of [[403, 'forbidden'], [401, 'failed'], [404, 'gone'], [410, 'expired'], [500, 'failed']] as const) {
      stub(json({ error: 'no' }, status))
      await expect(api.open()).resolves.toEqual({ ok: false, reason })
    }

    stub(new Error('offline'))
    await expect(api.open()).resolves.toEqual({ ok: false, reason: 'failed' })

    stub(new Response('not json', { status: 200 }))
    await expect(api.open()).resolves.toEqual({ ok: false, reason: 'failed' })

    for (const body of [[], { code: 'ABCD2345' }, { expiresAt: 1 }, 'nonsense']) {
      stub(json(body))
      await expect(api.open()).resolves.toEqual({ ok: false, reason: 'failed' })
    }
  })

  it('lists waiting requests and rejects entries it cannot read', async () => {
    const api = createPairingApi()
    stub(json({ requests: [
      { code: 'ABCD2345', openedAt: 1, expiresAt: 2, userAgent: 'agent' },
      { code: 'EFGH6789', openedAt: 3, expiresAt: 4 },
    ] }))
    await expect(api.requests()).resolves.toEqual({
      ok: true,
      value: [
        { code: 'ABCD2345', openedAt: 1, expiresAt: 2, userAgent: 'agent' },
        { code: 'EFGH6789', openedAt: 3, expiresAt: 4, userAgent: undefined },
      ],
    })

    for (const body of [{}, [], { requests: 'none' }, { requests: [42] }, { requests: [{ code: 'ABCD2345' }] }]) {
      stub(json(body))
      await expect(api.requests()).resolves.toEqual({ ok: false, reason: 'failed' })
    }

    stub(json({ error: 'no' }, 403))
    await expect(api.requests()).resolves.toEqual({ ok: false, reason: 'forbidden' })
  })

  it('applies a decision with the label it was given', async () => {
    const fetchMock = stub(json({ ok: true }))

    await expect(createPairingApi().decide('ABCD2345', '客厅的手机', true)).resolves.toEqual({
      ok: true,
      value: undefined,
    })
    expect(fetchMock).toHaveBeenCalledWith('/pair/approve', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'ABCD2345', label: '客厅的手机', allowed: true }),
    })

    stub(json({ error: 'settled' }, 409))
    await expect(createPairingApi().decide('ABCD2345', 'phone', true)).resolves.toEqual({ ok: false, reason: 'failed' })
  })

  it('lists devices and rejects entries it cannot read', async () => {
    const api = createPairingApi()
    stub(json({ devices: [{ id: 'device-1', label: 'iPad', registeredAt: 1, lastSeenAt: 2 }] }))
    await expect(api.devices()).resolves.toEqual({
      ok: true,
      value: [{ id: 'device-1', label: 'iPad', registeredAt: 1, lastSeenAt: 2 }],
    })

    for (const body of [{}, [], { devices: {} }, { devices: [{ id: 'device-1' }] }, { devices: [null] }]) {
      stub(json(body))
      await expect(api.devices()).resolves.toEqual({ ok: false, reason: 'failed' })
    }

    stub(json({ error: 'no' }, 404))
    await expect(api.devices()).resolves.toEqual({ ok: false, reason: 'gone' })
  })

  it('revokes a device and reports a refusal the Host answered', async () => {
    const fetchMock = stub(json({ ok: true }))
    await expect(createPairingApi().revoke('device-1')).resolves.toEqual({ ok: true, value: undefined })
    expect(fetchMock).toHaveBeenCalledWith('/pair/revoke', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'device-1' }),
    })

    stub(json({ ok: false }))
    await expect(createPairingApi().revoke('device-1')).resolves.toEqual({ ok: false, reason: 'failed' })

    stub(json([]))
    await expect(createPairingApi().revoke('device-1')).resolves.toEqual({ ok: false, reason: 'failed' })

    stub(json({ error: 'no' }, 410))
    await expect(createPairingApi().revoke('device-1')).resolves.toEqual({ ok: false, reason: 'expired' })
  })
})

describe('pairing helpers', () => {
  it('derives a device name from the phone agent', () => {
    expect(deviceLabelFrom('Mozilla/5.0 (Linux; Android 10; JAD-AL50) AppleWebKit/537.36')).toBe('JAD-AL50')
    expect(deviceLabelFrom('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('iPhone')
    expect(deviceLabelFrom('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('iPad')
    expect(deviceLabelFrom('Mozilla/5.0 (Linux; Android 10; )')).toBeUndefined()
    expect(deviceLabelFrom('curl/8.0')).toBeUndefined()
    expect(deviceLabelFrom(undefined)).toBeUndefined()
  })

  it('composes a token-free pairing URL from the LAN join URL', () => {
    expect(pairingUrlOf('http://192.168.1.5:3080/?token=secret', 'ABCD2345'))
      .toBe('http://192.168.1.5:3080/pair?c=ABCD2345')
    expect(pairingUrlOf('http://192.168.1.5:3080/deep/path?token=secret#frag', 'EFGH6789'))
      .toBe('http://192.168.1.5:3080/pair?c=EFGH6789')
  })
})
