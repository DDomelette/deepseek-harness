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
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { freezeMessage, type ContentBlock, type UserMessage } from '@deepseek-ai/dsh-llm'
import { parseSessionReferenceText, type SessionReferenceInput } from '@deepseek-ai/dsh-session-reference'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'session-reference-admission'

/** The resolver whose snapshots this plugin admits into pre-step decisions. */
export const inject = ['sessionReferenceResolver']

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
