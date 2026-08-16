/**
 * Pre-step admission for canonical session-reference mentions.
 *
 * The listener registers with `prepend: true` so it is the outermost
 * waterfall listener: `next()` settles every downstream pre-step
 * contribution first, then this plugin rewrites only direct user messages
 * carrying canonical `dsh-session:` mentions.
 * @module @deepseek-ai/dsh-session-reference-admission
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { freezeMessage, type ContentBlock, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import {
  parseSessionReferenceText,
  SessionReferenceError,
  type SessionReferenceInput,
} from '@deepseek-ai/dsh-session-reference'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'session-reference-admission'

/** The resolver and corpus whose records admit session-reference snapshots. */
export const inject = ['sessionReferenceResolver', 'sessionQuery']

/** Rejection for references crossing the current workspace boundary. */
const WORKSPACE_BOUNDARY_MESSAGE = 'session reference crosses the current workspace boundary'

/** One direct message after mention parsing. */
interface NormalizedMessage {
  readonly content: ContentBlock[]
  readonly references: SessionReferenceInput[]
}

/** Parse text blocks and collect references; `undefined` means no mention. */
function normalizeDirectMessage(content: readonly ContentBlock[]): NormalizedMessage | undefined {
  const references: SessionReferenceInput[] = []
  let found = false
  const normalized = content.map((block) => {
    if (block.type !== 'text') return block
    const parsed = parseSessionReferenceText(block.text)
    if (parsed.references.length > 0) {
      found = true
      references.push(...parsed.references)
    }
    return { type: 'text' as const, text: parsed.text }
  })
  return found ? { content: normalized, references } : undefined
}

/** Reject references whose source session is outside the target workspace. */
function assertSameWorkspace(
  agent: Agent,
  references: readonly SessionReferenceInput[],
  records: readonly SessionRecord[],
): void {
  const targetCwd = agent.session.header.cwd
  if (targetCwd === undefined) {
    throw new SessionReferenceError(
      `${WORKSPACE_BOUNDARY_MESSAGE}: current session has no cwd`,
      'SESSION_REFERENCE_INVALID_REFERENCE',
    )
  }
  const cwdById = new Map(records.map(record => [record.header.id, record.header.cwd]))
  for (const reference of references) {
    if (cwdById.get(reference.sessionId) !== targetCwd) {
      throw new SessionReferenceError(
        `${WORKSPACE_BOUNDARY_MESSAGE}: ${reference.sessionId}`,
        'SESSION_REFERENCE_INVALID_REFERENCE',
      )
    }
  }
}

/** Host plugin body: prepended pre-step listener over the root context. */
export function apply(ctx: Context): void {
  ctx.on('agent/pre-step', async (
    { agent, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const output: UserMessage[] = []
    let changed = false
    for (const message of decision.messages) {
      if (message.role !== 'user' || message.source.kind !== 'user') {
        output.push(message)
        continue
      }
      const normalized = normalizeDirectMessage(message.content)
      if (normalized === undefined) {
        output.push(message)
        continue
      }
      const records = await ctx.sessionQuery.listSessions(signal)
      signal.throwIfAborted()
      assertSameWorkspace(agent, normalized.references, records)
      const prepared = await ctx.sessionReferenceResolver.prepare(
        agent,
        normalized.content,
        normalized.references,
        signal,
      )
      signal.throwIfAborted()
      if (prepared.additionalContext !== undefined) output.push(prepared.additionalContext)
      output.push(freezeMessage({ ...message, content: prepared.content }))
      changed = true
    }
    return changed ? { kind: 'enter', messages: output } : decision
  }, { prepend: true })
}
