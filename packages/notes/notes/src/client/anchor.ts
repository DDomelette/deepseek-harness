/**
 * What a collection records about where its passage came from.
 *
 * A conversation row carries its identities as DOM attributes: the chat seat
 * writes `data-chat-seq` and `data-chat-message-id` on the row, a tool wrapper
 * inside it writes `data-chat-call-id`, and the trajectory table writes
 * `data-trajectory-seq` and `data-trajectory-call-id` on its own row. Reading
 * them beside the selection keeps the anchor where the passage is; the right
 * column holds no reader for either view's nodes.
 * @module @deepseek-ai/dsh-notes/client/anchor
 */

import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'

/** The identities one collected passage carries, absent ones as null. */
export interface CollectedAnchor {
  /** Durable sequence of the event the row renders, when the row carries one. */
  readonly seq: SessionSeq | null
  /** Durable message id, when the row is a conversation message. */
  readonly messageId: MessageId | null
  /** Tool call id, when the row is a tool call or a tool trajectory record. */
  readonly callId: string | null
}

/** What a passage outside every anchored row records. */
const UNANCHORED: CollectedAnchor = { seq: null, messageId: null, callId: null }

/**
 * Read the identities of the row one selection starts in.
 * @param start - the selection's starting node.
 * @returns the identities nearest to the passage, each null when none carries it.
 */
export function anchorAt(start: Node | null): CollectedAnchor {
  const element = start !== null && start instanceof Element ? start : start?.parentElement ?? null
  if (element === null) return UNANCHORED
  return {
    seq: sequence(attribute(element, 'data-chat-seq') ?? attribute(element, 'data-trajectory-seq')),
    messageId: message(attribute(element, 'data-chat-message-id')),
    callId: attribute(element, 'data-chat-call-id') ?? attribute(element, 'data-trajectory-call-id'),
  }
}

/**
 * Read one attribute from the nearest ancestor that carries it.
 * @param element - the node the selection started in.
 * @param name - the attribute to look for.
 * @returns the attribute as rendered, or null when no ancestor carries it.
 */
function attribute(element: Element, name: string): string | null {
  return element.closest(`[${name}]`)?.getAttribute(name) ?? null
}

/**
 * Read one rendered sequence attribute.
 * @param value - the attribute as rendered.
 * @returns the store's sequence, or null when the attribute is absent or unusable.
 */
function sequence(value: string | null): SessionSeq | null {
  if (value === null || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? brandNumber<SessionSeq>(parsed) : null
}

/**
 * Read one rendered message-id attribute.
 * @param value - the attribute as rendered.
 * @returns the message id, or null when the attribute is absent or empty.
 */
function message(value: string | null): MessageId | null {
  return value === null || value === '' ? null : brandString<MessageId>(value)
}
