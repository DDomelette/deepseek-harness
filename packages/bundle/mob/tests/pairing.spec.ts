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

    // A code the computer minted is not a request: it enters the list only
    // once a phone claims it.
    expect(store.pending()).toEqual([])

    store.recordAgent(code, 'Mozilla/5.0 (Linux; Android 10; JAD-AL50)', '192.168.0.122')
    expect(store.pending()).toEqual([{
      code,
      openedAt: START,
      expiresAt: START + 120_000,
      userAgent: 'Mozilla/5.0 (Linux; Android 10; JAD-AL50)',
    }])
    expect(store.sourceOf(code)).toBe('192.168.0.122')

    store.recordAgent(code, 'another agent', '192.168.0.200')
    expect(store.pending()[0]?.userAgent).toBe('Mozilla/5.0 (Linux; Android 10; JAD-AL50)')
    expect(store.sourceOf(code)).toBe('192.168.0.122')

    const settled = store.openSession()
    expect(store.sourceOf(settled.code)).toBeUndefined()
    expect(store.approve(settled.code, 'phone', false)).toEqual({ ok: true })
    store.recordAgent(settled.code, 'too late', '192.168.0.201')
    store.recordAgent('ZZZZZZZZ', 'no such code', '192.168.0.202')
    expect(store.sourceOf('ZZZZZZZZ')).toBeUndefined()
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

  it('clears the failure count once a code resolves', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    const store = sessions()
    const { code } = store.openSession()

    for (let attempt = 1; attempt <= 4; attempt++) {
      expect(store.stateOf('ZZZZZZZZ', 'source')).toEqual({ status: 'unknown' })
    }
    expect(store.stateOf(code, 'source')).toEqual({ status: 'pending' })
    // The live read cleared the four failures, so five more are needed to lock.
    for (let attempt = 1; attempt <= 4; attempt++) {
      expect(store.stateOf('ZZZZZZZZ', 'source')).toEqual({ status: 'unknown' })
    }
    expect(store.stateOf('ZZZZZZZZ', 'source')).toEqual({ status: 'locked' })
  })

  it('keeps a live code readable however often its pages poll, while a code search still locks', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    const store = sessions()
    const { code } = store.openSession()

    // Two pages holding one code poll it far past the ten-read window: the
    // session in flight is not the code space being searched.
    for (let attempt = 1; attempt <= 40; attempt++) {
      expect(store.stateOf(code, 'phone-a')).toEqual({ status: 'pending' })
      expect(store.stateOf(code, 'phone-b')).toEqual({ status: 'pending' })
    }

    // Reads that name no live code are the search the throttle exists for: the
    // fifth consecutive failure locks that source.
    for (let attempt = 1; attempt <= 4; attempt++) {
      expect(store.stateOf('ZZZZZZZZ', 'searcher')).toEqual({ status: 'unknown' })
    }
    expect(store.stateOf('ZZZZZZZZ', 'searcher')).toEqual({ status: 'locked' })

    // The lock defends the code space, not a session already in flight: the
    // phone it locked can still collect the decision for the code it holds.
    expect(store.stateOf(code, 'searcher')).toEqual({ status: 'pending' })
  })

  it('locks a source that floods past the attempt budget without failing five in a row', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    const store = sessions()
    const { code } = store.openSession()

    // A live read clears the failure count, so alternating it with guesses keeps
    // this source under the consecutive-failure limit; the per-window attempt
    // budget is what stops the search.
    for (let round = 1; round <= 2; round++) {
      for (let attempt = 1; attempt <= 4; attempt++) {
        expect(store.stateOf('ZZZZZZZZ', 'flooder')).toEqual({ status: 'unknown' })
      }
      expect(store.stateOf(code, 'flooder')).toEqual({ status: 'pending' })
    }
    expect(store.stateOf('ZZZZZZZZ', 'flooder')).toEqual({ status: 'unknown' })
    expect(store.stateOf('ZZZZZZZZ', 'flooder')).toEqual({ status: 'unknown' })
    expect(store.stateOf('ZZZZZZZZ', 'flooder')).toEqual({ status: 'locked' })
  })

  it('reopens an allowed session whose registration failed, leaving denied and bound ones alone', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    const store = sessions()
    const { code } = store.openSession()

    expect(store.reopen(code)).toBe(false)

    expect(store.approve(code, 'phone', false)).toEqual({ ok: true })
    expect(store.reopen(code)).toBe(false)
    expect(store.stateOf(code, 'source')).toEqual({ status: 'denied' })

    const allowed = store.openSession()
    expect(store.approve(allowed.code, 'phone', true)).toEqual({ ok: true })
    expect(store.reopen(allowed.code)).toBe(true)
    // The phone reads the retry as pending, and the operator may decide again.
    expect(store.stateOf(allowed.code, 'source')).toEqual({ status: 'pending' })
    expect(store.approve(allowed.code, 'phone', true)).toEqual({ ok: true })
    expect(store.bindDevice(allowed.code, DEVICE_1)).toBe(true)
    expect(store.reopen(allowed.code)).toBe(false)

    const late = store.openSession()
    expect(store.approve(late.code, 'phone', true)).toEqual({ ok: true })
    vi.setSystemTime(new Date(START + 120_000))
    expect(store.reopen(late.code)).toBe(false)
  })

  it('forgets an idle throttle record and keeps one whose lockout is still running', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    const store = sessions()
    const sources = (store as unknown as { sources: Map<string, unknown> }).sources

    for (let attempt = 1; attempt <= 4; attempt++) store.stateOf('ZZZZZZZZ', `192.168.0.${attempt}`)
    for (let attempt = 1; attempt <= 5; attempt++) store.stateOf('ZZZZZZZZ', 'locked-peer')
    expect(sources.size).toBe(5)

    // The attempt window rolls over: the four idle records can only be rebuilt
    // identically, so the next sweep drops them, while the lockout outlives the
    // window that produced it.
    vi.setSystemTime(new Date(START + 10_001))
    store.pending()
    expect(sources.size).toBe(1)
    expect(store.stateOf('ZZZZZZZZ', 'locked-peer')).toEqual({ status: 'locked' })

    // Once the lockout ends that record is idle too, and the sweep drops it.
    vi.setSystemTime(new Date(START + 70_002))
    store.pending()
    expect(sources.size).toBe(0)
  })

  it('reports a bound code that expired uncollected and keeps an unbound one for its own read', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    const store = sessions()
    const claimed = store.openSession()
    const plain = store.openSession()
    expect(store.approve(claimed.code, 'phone', true)).toEqual({ ok: true })
    expect(store.bindDevice(claimed.code, DEVICE_1)).toBe(true)

    vi.setSystemTime(new Date(START + 120_000))
    // A code that expired with no registration keeps answering through its own read.
    expect(store.stateOf(plain.code, 'source')).toEqual({ status: 'expired' })
    // The bound one survives that same read: deleting it there would lose the
    // registration its phone never collected.
    expect(store.stateOf(claimed.code, 'source')).toEqual({ status: 'expired' })
    expect(store.sweepExpired()).toEqual([DEVICE_1])
    expect(store.sweepExpired()).toEqual([])
    expect(store.stateOf(claimed.code, 'source')).toEqual({ status: 'unknown' })
  })
})
