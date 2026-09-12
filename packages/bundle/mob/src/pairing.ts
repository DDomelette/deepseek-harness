/**
 * Pairing sessions: the short codes a computer generates and a phone claims.
 * A session is pending, then approved or denied once, and it hands its decision
 * out once; codes live two minutes and every read is throttled per source so a
 * phone on the network cannot search the code space.
 * @module @deepseek-ai/dsh-mob/src/pairing
 */

import { randomInt } from 'node:crypto'
import type { PairedDeviceId } from '@deepseek-ai/dsh-client-connection'

/** Code alphabet: base32 without the glyphs a phone camera or a human confuses (`0/O`, `1/I`). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8
const SESSION_TTL_MILLISECONDS = 120_000
const ATTEMPT_WINDOW_MILLISECONDS = 10_000
const ATTEMPT_LIMIT = 10
const FAILURE_LIMIT = 5
const LOCKOUT_MILLISECONDS = 60_000

/** A freshly opened session: the code to display and when it stops working. */
export interface PairingSessionHandle {
  /** The eight-character code. */
  readonly code: string
  /** Epoch milliseconds the code stops being claimable. */
  readonly expiresAt: number
}

/** One request waiting for a decision on the computer. */
export interface PendingPairing {
  /** The code the phone claimed. */
  readonly code: string
  /** Epoch milliseconds the session opened. */
  readonly openedAt: number
  /** Epoch milliseconds the code expires. */
  readonly expiresAt: number
  /** Agent of the phone that claimed the code, when one did. */
  readonly userAgent: string | undefined
}

/** What a phone learns when it reads its code, throttling included. */
export type PairingState =
  | { readonly status: 'unknown' }
  | { readonly status: 'locked' }
  | { readonly status: 'pending' }
  /** Published with the device row it names, so the decision and the cookie arrive together. */
  | { readonly status: 'approved'; readonly deviceId: PairedDeviceId }
  | { readonly status: 'denied' }
  | { readonly status: 'expired' }

/** Result of a decision made on the computer. */
export type PairingApproval =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'unknown' | 'expired' | 'settled' }

interface Session {
  readonly code: string
  readonly openedAt: number
  readonly expiresAt: number
  userAgent: string | undefined
  label: string | undefined
  /** Decision the computer recorded; undefined while the request still waits. */
  decision: 'allow' | 'deny' | undefined
  /** Set exactly when an allowed decision finished registering its device. */
  deviceId: PairedDeviceId | undefined
}

interface SourceAttempts {
  windowStart: number
  attempts: number
  failures: number
  lockedUntil: number
}

function randomCode(): string {
  let code = ''
  for (let index = 0; index < CODE_LENGTH; index++) {
    code += CODE_ALPHABET.charAt(randomInt(CODE_ALPHABET.length))
  }
  return code
}

/** In-memory pairing sessions of one Host process. */
export class PairingSessions {
  private readonly sessions = new Map<string, Session>()
  private readonly sources = new Map<string, SourceAttempts>()

  /**
   * Open a session and mint its code.
   * @returns the code to display and its expiry.
   */
  openSession(): PairingSessionHandle {
    const now = Date.now()
    this.sweep(now)
    let code = randomCode()
    /* v8 ignore next -- the 32^8 code space only collides while an identical live code exists. */
    while (this.sessions.has(code)) code = randomCode()
    const session: Session = {
      code,
      openedAt: now,
      expiresAt: now + SESSION_TTL_MILLISECONDS,
      userAgent: undefined,
      label: undefined,
      decision: undefined,
      deviceId: undefined,
    }
    this.sessions.set(code, session)
    return { code, expiresAt: session.expiresAt }
  }

  /**
   * Remember which agent claimed a code, for the label the approve dialog prefills.
   * @param code - the claimed code.
   * @param userAgent - the claiming request's `User-Agent`.
   */
  recordAgent(code: string, userAgent: string): void {
    const session = this.sessions.get(code)
    if (session === undefined || session.decision !== undefined) return
    session.userAgent ??= userAgent
  }

  /**
   * List the requests still waiting for a decision.
   * @returns the pending sessions in the order they opened.
   */
  pending(): readonly PendingPairing[] {
    this.sweep(Date.now())
    return [...this.sessions.values()]
      .filter(session => session.decision === undefined)
      .map(session => ({
        code: session.code,
        openedAt: session.openedAt,
        expiresAt: session.expiresAt,
        userAgent: session.userAgent,
      }))
  }

  /**
   * Read one code for a phone, consuming one attempt for that source.
   * @param code - the code the phone holds.
   * @param source - the requesting source, used for throttling.
   * @returns the session state, or `locked` while this source is throttled.
   */
  stateOf(code: string, source: string): PairingState {
    const now = Date.now()
    if (this.rateLimited(source, now)) return { status: 'locked' }
    const session = this.sessions.get(code)
    if (session === undefined) return this.failure(source, now, 'unknown')
    if (session.expiresAt <= now) {
      this.sessions.delete(code)
      return this.failure(source, now, 'expired')
    }
    this.attempts(source, now).failures = 0
    if (session.deviceId !== undefined) return { status: 'approved', deviceId: session.deviceId }
    if (session.decision === 'deny') return { status: 'denied' }
    return { status: 'pending' }
  }

  /**
   * Record the decision the computer made for a code. An allowed decision stays
   * pending until {@link bindDevice} attaches the registered device, so a phone
   * polling in between never collects an approval it cannot use.
   * @param code - the code under decision.
   * @param label - device label the operator approved, after any edit.
   * @param allowed - whether the phone is allowed to pair.
   * @returns whether the decision applied, and why it did not.
   */
  approve(code: string, label: string, allowed: boolean): PairingApproval {
    const now = Date.now()
    const session = this.sessions.get(code)
    if (session === undefined) return { ok: false, reason: 'unknown' }
    if (session.expiresAt <= now) return { ok: false, reason: 'expired' }
    if (session.decision !== undefined) return { ok: false, reason: 'settled' }
    session.label = label
    session.decision = allowed ? 'allow' : 'deny'
    return { ok: true }
  }

  /**
   * Publish an approved session with the device registered for it.
   * @param code - the code whose decision was allowed.
   * @param deviceId - id of the device row registered for it.
   * @returns true when the session took the id; false for an unknown, denied,
   * expired, or already-bound session.
   */
  bindDevice(code: string, deviceId: PairedDeviceId): boolean {
    const session = this.sessions.get(code)
    if (session === undefined || session.decision !== 'allow' || session.deviceId !== undefined) return false
    if (session.expiresAt <= Date.now()) return false
    session.deviceId = deviceId
    return true
  }

  /**
   * Drop a session after its phone collected the decision.
   * @param code - the collected code.
   */
  consume(code: string): void {
    this.sessions.delete(code)
  }

  /** Drop sessions whose codes expired. */
  private sweep(now: number): void {
    for (const [code, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(code)
    }
  }

  /**
   * Attempt bookkeeping for one source, restarting the window when it rolled
   * over while keeping a lockout that is still running.
   */
  private attempts(source: string, now: number): SourceAttempts {
    const current = this.sources.get(source)
    if (current !== undefined && now - current.windowStart < ATTEMPT_WINDOW_MILLISECONDS) return current
    const fresh: SourceAttempts = {
      windowStart: now,
      attempts: 0,
      failures: 0,
      // A new window must not outlive the lock it was opened under: the lockout
      // is measured from the flooding read, not from the window it landed in.
      lockedUntil: current !== undefined && now < current.lockedUntil ? current.lockedUntil : 0,
    }
    this.sources.set(source, fresh)
    return fresh
  }

  /** Consume one attempt, locking the source when it floods or keeps failing. */
  private rateLimited(source: string, now: number): boolean {
    const state = this.attempts(source, now)
    if (now < state.lockedUntil) return true
    state.attempts += 1
    if (state.attempts > ATTEMPT_LIMIT) {
      state.lockedUntil = now + LOCKOUT_MILLISECONDS
      state.failures = 0
      return true
    }
    return false
  }

  /** Count one failed read, locking the source on the fifth in a row. */
  private failure(source: string, now: number, status: 'unknown' | 'expired'): PairingState {
    const state = this.attempts(source, now)
    state.failures += 1
    if (state.failures >= FAILURE_LIMIT) {
      state.lockedUntil = now + LOCKOUT_MILLISECONDS
      state.failures = 0
      return { status: 'locked' }
    }
    return { status }
  }
}
