/** Pairing-session lifecycle: short codes, approval, revocation-free single use, and throttling. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PairedDeviceId } from '@deepseek-ai/dsh-client-connection'
import { PairingSessions } from '../src/pairing.ts'

const START = Date.parse('2026-09-12T12:00:00.000Z')

/** Device ids as the registry mints them; these tests only need the brand. */
const DEVICE_1 = 'device-1' as PairedDeviceId
const DEVICE_2 = 'device-2' as PairedDeviceId

function sessions(): PairingSessions {
  return new PairingSessions()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('PairingSessions', () => {
  it('opens a session with an eight-character code from the unambiguous alphabet', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    const store = sessions()

    const first = store.openSession()
    const second = store.openSession()

    expect(first.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/u)
    expect(first.code).not.toBe(second.code)
    expect(first.expiresAt).toBe(START + 120_000)
    expect(store.stateOf(first.code, '192.168.0.122')).toEqual({ status: 'pending' })
  })

  it('lists pending requests with the phone agent that claimed them', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    const store = sessions()
    const { code } = store.openSession()

    store.recordAgent(code, 'Mozilla/5.0 (Linux; Android 10; JAD-AL50)')
    expect(store.pending()).toEqual([{
      code,
      openedAt: START,
      expiresAt: START + 120_000,
      userAgent: 'Mozilla/5.0 (Linux; Android 10; JAD-AL50)',
    }])

    store.recordAgent(code, 'another agent')
    expect(store.pending()[0]?.userAgent).toBe('Mozilla/5.0 (Linux; Android 10; JAD-AL50)')

    const settled = store.openSession()
    expect(store.approve(settled.code, 'phone', false)).toEqual({ ok: true })
    store.recordAgent(settled.code, 'too late')
    store.recordAgent('ZZZZZZZZ', 'no such code')
    expect(store.pending().map(entry => entry.code)).toEqual([code])
  })

  it('expires a code after two minutes and sweeps it from the pending list', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    const store = sessions()
    const { code } = store.openSession()
    store.openSession()

    vi.setSystemTime(new Date(START + 119_999))
    expect(store.stateOf(code, 'source')).toEqual({ status: 'pending' })

    vi.setSystemTime(new Date(START + 120_000))
    expect(store.stateOf(code, 'source')).toEqual({ status: 'expired' })
    expect(store.pending()).toEqual([])
  })

  it('approves once, binds one device, and hands the decision out once', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    const store = sessions()
    const { code } = store.openSession()

    expect(store.bindDevice(code, DEVICE_1)).toBe(false)
    expect(store.approve(code, 'HUAWEI JAD-AL50', true)).toEqual({ ok: true })
    // An allowed decision stays pending until its device row exists, so a phone
    // polling in between never collects an approval it cannot use.
    expect(store.stateOf(code, 'source')).toEqual({ status: 'pending' })
    expect(store.pending()).toEqual([])

    expect(store.bindDevice(code, DEVICE_1)).toBe(true)
    expect(store.bindDevice(code, DEVICE_2)).toBe(false)
    expect(store.stateOf(code, 'source')).toEqual({ status: 'approved', deviceId: DEVICE_1 })

    store.consume(code)
    expect(store.stateOf(code, 'source')).toEqual({ status: 'unknown' })
  })

  it('refuses to bind a device to a code that expired first', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    const store = sessions()
    const { code } = store.openSession()

    expect(store.approve(code, 'phone', true)).toEqual({ ok: true })
    vi.setSystemTime(new Date(START + 120_000))
    expect(store.bindDevice(code, DEVICE_1)).toBe(false)
    expect(store.stateOf(code, 'source')).toEqual({ status: 'expired' })
  })

  it('rejects a second decision and a decision on an unknown or expired code', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    const store = sessions()
    const { code } = store.openSession()

    expect(store.approve(code, 'phone', false)).toEqual({ ok: true })
    expect(store.stateOf(code, 'source')).toEqual({ status: 'denied' })
    expect(store.approve(code, 'phone', true)).toEqual({ ok: false, reason: 'settled' })
    expect(store.bindDevice(code, DEVICE_1)).toBe(false)

    expect(store.approve('ZZZZZZZZ', 'phone', true)).toEqual({ ok: false, reason: 'unknown' })

    const expiring = store.openSession()
    vi.setSystemTime(new Date(START + 120_000))
    expect(store.approve(expiring.code, 'phone', true)).toEqual({ ok: false, reason: 'expired' })
  })

  it('locks a source after five consecutive failed codes and lifts the lock after a minute', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    const store = sessions()

    for (let attempt = 1; attempt <= 4; attempt++) {
      expect(store.stateOf('ZZZZZZZZ', 'source')).toEqual({ status: 'unknown' })
    }
    expect(store.stateOf('ZZZZZZZZ', 'source')).toEqual({ status: 'locked' })
    expect(store.stateOf('ZZZZZZZZ', 'source')).toEqual({ status: 'locked' })

    vi.setSystemTime(new Date(START + 60_001))
    expect(store.stateOf('ZZZZZZZZ', 'source')).toEqual({ status: 'unknown' })
    expect(store.stateOf('ZZZZZZZZ', 'other-source')).toEqual({ status: 'unknown' })
  })

  it('keeps a lockout across the attempt window that follows it', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    const store = sessions()

    for (let attempt = 1; attempt <= 5; attempt++) store.stateOf('ZZZZZZZZ', 'source')
    expect(store.stateOf('ZZZZZZZZ', 'source')).toEqual({ status: 'locked' })

    // The ten-second attempt window rolls over well before the lockout ends;
    // the lock is measured from the flooding read, not from that window.
    vi.setSystemTime(new Date(START + 10_001))
    expect(store.stateOf('ZZZZZZZZ', 'source')).toEqual({ status: 'locked' })
    vi.setSystemTime(new Date(START + 59_999))
    expect(store.stateOf('ZZZZZZZZ', 'source')).toEqual({ status: 'locked' })
    vi.setSystemTime(new Date(START + 60_001))
    expect(store.stateOf('ZZZZZZZZ', 'source')).toEqual({ status: 'unknown' })
  })

  it('clears the failure count once a code resolves and rate-limits attempts per source', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    const store = sessions()
    const { code } = store.openSession()

    for (let attempt = 1; attempt <= 4; attempt++) {
      expect(store.stateOf('ZZZZZZZZ', 'source')).toEqual({ status: 'unknown' })
    }
    expect(store.stateOf(code, 'source')).toEqual({ status: 'pending' })
    for (let attempt = 1; attempt <= 4; attempt++) {
      expect(store.stateOf('ZZZZZZZZ', 'source')).toEqual({ status: 'unknown' })
    }

    for (let attempt = 1; attempt <= 10; attempt++) {
      expect(store.stateOf(code, 'flooder')).toEqual({ status: 'pending' })
    }
    expect(store.stateOf(code, 'flooder')).toEqual({ status: 'locked' })

    vi.setSystemTime(new Date(START + 60_001))
    expect(store.stateOf(code, 'flooder')).toEqual({ status: 'pending' })
  })
})
