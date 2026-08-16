import type { SessionId } from '@deepseek-ai/dsh-session'

/** Open presentation flags attached to one session. */
export interface SessionFlags {
  readonly pinned?: boolean
}

/** Supplies flags for sessions the provider owns. */
export interface SessionFlagProvider {
  readonly id: string
  list(): Readonly<Record<SessionId, SessionFlags>>
}

/** Merged provider projection. `complete` is false after any provider failure. */
export interface SessionFlagsSnapshot {
  readonly flags: Readonly<Record<SessionId, SessionFlags>>
  readonly complete: boolean
}
