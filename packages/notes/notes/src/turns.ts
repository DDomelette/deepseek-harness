/**
 * Turn outcomes: what one closed turn carried, and how it ended.
 *
 * A material's status is not knowable when its message is submitted —
 * `Agent.followup()` returns void, and the answer arrives one turn later — so
 * the closing turn is what settles it. Both facts are read from the session log
 * rather than tracked in memory: the log is the durable truth, it survives a
 * restart, and the same structural reading attributes a persisted event list.
 * @module @deepseek-ai/dsh-notes/turns
 */

import type { AttributedRow } from './thread.ts'

/** How one closed turn leaves the materials it carried. */
export interface TurnOutcome {
  /** Whether the model answered the turn. */
  readonly answered: boolean
  /** A readable reason the turn failed, or null when it completed. */
  readonly reason: string | null
}

/**
 * The user messages one turn carried.
 * @param events - the session's events, in any order.
 * @param turn - the turn number a closing event reports.
 * @returns the ids of that turn's own user messages, in sequence order.
 */
export function turnMessages(events: readonly AttributedRow[], turn: number): string[] {
  const ids: string[] = []
  let open: number | null = null
  for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
    if (event.type === 'turn/start') {
      open = numberOf(event.data)
      continue
    }
    if (event.type === 'turn/end') {
      open = null
      continue
    }
    if (open !== turn || event.type !== 'user/message') continue
    const id = stringOf(asPayload(event.data)?.['id'])
    if (id !== undefined) ids.push(id)
  }
  return ids
}

/**
 * How one turn end leaves the materials it carried.
 * @param data - the `turn/end` event's payload.
 * @returns whether the model answered, and a readable reason when it did not.
 */
export function turnOutcome(data: unknown): TurnOutcome {
  const reason = asPayload(asPayload(data)?.['reason'])
  const kind = reason?.['kind']
  if (kind === 'completed') return { answered: true, reason: null }
  if (kind === 'error') {
    const failure = asPayload(reason?.['error'])
    return { answered: false, reason: stringOf(failure?.['message']) ?? 'the model call failed' }
  }
  return { answered: false, reason: typeof kind === 'string' ? `the turn ended: ${kind}` : 'the turn ended' }
}

/** One structurally readable payload, or undefined for a primitive or null. */
function asPayload(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

/** One string member of a payload, or undefined for any other value. */
function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** One numeric member of a payload, or null for any other value. */
function numberOf(value: unknown): number | null {
  const turn = asPayload(value)?.['turn']
  return typeof turn === 'number' ? turn : null
}
