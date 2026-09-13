/**
 * Thread attribution: which session events belong to one material.
 *
 * Attribution is explicit, never positional. A follow-up may arrive long after
 * the material's first analysis and after other materials were analysed, so a
 * contiguous range would steal a neighbour's events. The material records the
 * ids of its own user messages; this function takes, for each, the events up to
 * the next user message.
 *
 * Identity is matched, not sequence: `Agent.followup()` returns void, so the
 * sequence a message lands on is not knowable when it is sent, while its id is
 * known before the send.
 * @module @deepseek-ai/dsh-notes/thread
 */

/** The minimum an event must expose to be attributed. */
export interface AttributedRow {
  /** Monotonic sequence within the session. */
  readonly seq: number
  /** Session event type. */
  readonly type: string
  /** Session event payload; a `user/message` payload is a `UserMessage` carrying `id`. */
  readonly data?: { readonly id?: string }
}

/**
 * Events belonging to one material.
 * @param events - the session's events, in any order.
 * @param messageIds - ids of this material's own user messages.
 * @returns the attributed events in sequence order.
 */
export function attributeThread<T extends AttributedRow>(
  events: readonly T[],
  messageIds: readonly string[],
): T[] {
  const owned = new Set(messageIds)
  if (owned.size === 0) return []
  const ordered = [...events].sort((left, right) => left.seq - right.seq)
  const thread: T[] = []
  let collecting = false
  for (const event of ordered) {
    if (event.type === 'user/message') collecting = owns(event, owned)
    if (collecting) thread.push(event)
  }
  return thread
}

/**
 * Whether one user/message event is one of the material's own.
 * @param event - the candidate event.
 * @param owned - the material's message ids.
 * @returns true when the event carries one of those ids.
 */
function owns(event: AttributedRow, owned: ReadonlySet<string>): boolean {
  const id = event.data?.id
  return id !== undefined && owned.has(id)
}
