import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Complete pin state returned by every Remote method. */
export interface SessionPinsSnapshot {
  readonly pinnedSessionIds: readonly SessionId[]
  readonly groupOrder: Readonly<Record<string, readonly SessionId[]>>
  readonly flatOrder: readonly SessionId[]
}
