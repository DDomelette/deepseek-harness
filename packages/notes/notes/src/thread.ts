/**
 * Thread attribution: which session events belong to one material, and what the
 * panel draws from them.
 *
 * Attribution is explicit, never positional. A follow-up may arrive long after
 * the material's first analysis and after other materials were analysed, so a
 * contiguous range would steal a neighbour's events. The material records the
 * ids of its own user messages; this function takes, for each, the events up to
 * the next prompt the conversation received.
 *
 * A prompt is a user message that declares no context form: a person's message,
 * or one a plugin submitted. The harness also lands its own context — workspace
 * instructions, a system-prompt snapshot, the skill catalog — as user messages
 * inside the turn it belongs to, and each of those declares the form its text
 * was rendered in. Treating that context as a boundary would end a material's
 * segment before the answer arrived, so the segment carries it transparently and
 * the projection draws no row for it.
 *
 * Identity is matched, not sequence: `Agent.followup()` returns void, so the
 * sequence a message lands on is not knowable when it is sent, while its id is
 * known before the send.
 *
 * Both functions read the payload structurally rather than through the session
 * event union: attribution needs only a message id, and the projection needs
 * only a message's role and text parts. The session's own types are therefore
 * not a dependency of this module, and a persisted event list of the same
 * nesting is attributed by the same code.
 * @module @deepseek-ai/dsh-notes/thread
 */

/** The minimum an event must expose to be attributed. */
export interface AttributedRow {
  /** Monotonic sequence within the session. */
  readonly seq: number
  /** Session event type. */
  readonly type: string
  /** Session event payload, read structurally. */
  readonly data?: unknown
}

/** One row of a material's thread, as the panel draws it. */
export interface ThreadRow {
  /** Whether the row is the material's own submission or the model's answer. */
  readonly role: 'user' | 'assistant'
  /** Every text part of the message, joined with a blank line. */
  readonly text: string
  /** Whether the message carried an image part, which contributes no text. */
  readonly hasImage: boolean
  /** Session sequence the row came from. */
  readonly seq: number
}

/** One message's role and text parts, as the projection read them. */
interface MessageBody {
  readonly role: 'user' | 'assistant'
  readonly content: unknown
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
    // Context the harness injected is carried by the segment it lands in; only
    // a prompt the conversation received opens or closes one.
    if (event.type === 'user/message' && !isContext(event)) collecting = owns(event, owned)
    if (collecting) thread.push(event)
  }
  return thread
}

/**
 * The rows one material's thread draws: its own submissions and the model's
 * answers, in sequence order.
 *
 * A message with no text and no image — an assistant turn that only carried a
 * tool call, a usage-only record — contributes no row, so the panel never draws
 * an empty bubble. Context the harness injected contributes no row either, for
 * the same reason its text is not the conversation's: it is the harness talking
 * to the model, not a prompt anyone sent. A screenshot submission carries no
 * text and is kept: the row says what it holds rather than showing nothing.
 * @param events - the session's events, in any order.
 * @param messageIds - ids of this material's own user messages.
 * @returns the rows, ascending by sequence.
 */
export function projectThread(events: readonly AttributedRow[], messageIds: readonly string[]): ThreadRow[] {
  const rows: ThreadRow[] = []
  for (const event of attributeThread(events, messageIds)) {
    const message = messageOf(event)
    if (message === undefined) continue
    if (message.role === 'user' && isContext(event)) continue
    const text = textOf(message.content)
    const hasImage = carriesImage(message.content)
    if (text === '' && !hasImage) continue
    rows.push({ role: message.role, text, hasImage, seq: event.seq })
  }
  return rows
}

/**
 * Whether one user message is context the harness injected rather than a prompt
 * the conversation received.
 *
 * A context contribution declares the form its text was rendered in; a prompt
 * from a person or a plugin declares none.
 * @param event - one user/message event.
 * @returns true when the event carries a context form.
 */
function isContext(event: AttributedRow): boolean {
  const source = asPayload(asPayload(event.data)?.['source'])
  return typeof source?.['form'] === 'string'
}

/**
 * The message one attributed event carries: an assistant turn nests it, a user
 * turn is it. Every other event type carries none.
 * @param event - one attributed event.
 * @returns the role and content, or undefined when the event carries no
 *   user- or assistant-role message.
 */
function messageOf(event: AttributedRow): MessageBody | undefined {
  const data = asPayload(event.data)
  if (data === undefined) return undefined
  if (event.type === 'user/message') return messageBody(data)
  return event.type === 'assistant/message' ? messageBody(data['message']) : undefined
}

/** One message payload as a role and its content, or undefined for any other value. */
function messageBody(value: unknown): MessageBody | undefined {
  const payload = asPayload(value)
  const role = payload?.['role']
  if (payload === undefined || (role !== 'user' && role !== 'assistant')) return undefined
  return { role, content: payload['content'] }
}

/**
 * Every text part of one message's content, joined with a blank line. A
 * non-text part — an image, a tool call — contributes nothing.
 */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const texts: string[] = []
  for (const block of content) {
    const part = asPayload(block)
    if (part === undefined || part['type'] !== 'text') continue
    const text = part['text']
    if (typeof text === 'string') texts.push(text)
  }
  return texts.join('\n\n')
}

/** Whether one message's content carries an image part, which draws as its own row. */
function carriesImage(content: unknown): boolean {
  if (!Array.isArray(content)) return false
  return content.some(block => asPayload(block)?.['type'] === 'image')
}

/** One structurally readable payload, or undefined for a primitive or null. */
function asPayload(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

/**
 * Whether one user/message event is one of the material's own.
 * @param event - the candidate event.
 * @param owned - the material's message ids.
 * @returns true when the event carries one of those ids.
 */
function owns(event: AttributedRow, owned: ReadonlySet<string>): boolean {
  const id = asPayload(event.data)?.['id']
  return typeof id === 'string' && owned.has(id)
}
