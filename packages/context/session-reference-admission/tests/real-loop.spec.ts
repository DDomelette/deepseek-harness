import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createMessage, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SessionReferenceResolver, { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
import * as admission from '@deepseek-ai/dsh-session-reference-admission'
import { describe, expect, it } from 'vitest'

class TestSessionQueryEngine extends SessionQueryEngine {
  override searchSessions(
    ..._args: Parameters<SessionQueryEngine['searchSessions']>
  ): ReturnType<SessionQueryEngine['searchSessions']> {
    return Promise.resolve({ items: [] })
  }

  override searchEvents(
    ...args: Parameters<SessionQueryEngine['searchEvents']>
  ): ReturnType<SessionQueryEngine['searchEvents']> {
    return this.readSurface(args[0].sessionId).then(surface => ({
      session: surface.session,
      items: [],
    }))
  }
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield* textResponse('ok')
  }
}

async function harness() {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(TestSessionQueryEngine)
  await ctx.plugin(SessionReferenceResolver)
  await ctx.plugin(admission)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new ScriptedAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, adapter }
}

describe('session-reference admission in the real agent loop', () => {
  it('sends the snapshot immediately before the readable direct message', async () => {
    const { ctx, adapter } = await harness()
    const source = ctx.sessions.create(SessionId('source'), { meta: { cwd: '/work' } })
    source.append('turn/start', { turn: 1 })
    source.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'source user' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    source.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'source assistant' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      }),
    }, { surfaceOp: 'append' })
    source.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const target = ctx.agentLoop.create(SessionId('target'), { provider: 'mock', model: 'mock' })
    target.followup(createUserMessage({
      content: [{
        type: 'text',
        text: `交接 ${formatSessionReferenceMention({ sessionId: source.id, label: '源' })} 请继续`,
      }],
      source: { kind: 'user' },
    }))
    await target.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    const messages = adapter.requests[0]!.messages
    const snapshotIndex = messages.findIndex(message =>
      message.role === 'user' && message.source.kind === 'session-reference')
    const directIndex = messages.findIndex(message =>
      message.role === 'user' && message.source.kind === 'user')
    expect(snapshotIndex).toBeGreaterThanOrEqual(0)
    expect(directIndex).toBe(snapshotIndex + 1)
  })
})
