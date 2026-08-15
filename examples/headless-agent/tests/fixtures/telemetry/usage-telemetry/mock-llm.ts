import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** Deterministic one-step adapter for the usage telemetry Loader fixture. */
class UsageTelemetryMockAdapter extends LlmAdapter {
  async * stream(): AsyncIterable<StreamChunk> {
    const text = 'usage telemetry measured'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 3, cacheWriteTokens: 2 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'usage-telemetry-mock-llm'
export const inject = ['llm']

/** Register the fixture's `usage-telemetry-mock` adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['usage-telemetry-mock'], new UsageTelemetryMockAdapter())
}
