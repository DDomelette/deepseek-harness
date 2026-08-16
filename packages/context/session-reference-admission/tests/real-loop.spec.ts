import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import {
  CallId,
  createMessage,
  createUserMessage,
  LlmAdapter,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SessionReferenceResolver, { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
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

function toolCallResponse(): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: CallId('echo-1'), name: 'echo', arguments: '{"text":"ping"}' },
    },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: StreamChunk[][]) {
    super()
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const chunks = this.script.shift()
    if (chunks === undefined) throw new Error('ScriptedAdapter: script exhausted')
    yield* chunks
  }
}

async function harness(script: StreamChunk[][] = [textResponse('ok')]) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(TestSessionQueryEngine)
  await ctx.plugin(SessionReferenceResolver)
  await ctx.plugin(admission)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.tools.register(defineContentToolFixture({
    name: 'echo',
    description: 'echo text',
    parameters: { text: { type: 'string', required: true } },
    execute: async ({ text }) => [{ type: 'text', text: String(text) }],
  }))
  const adapter = new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, adapter }
}

function appendSourceConversation(ctx: Context): SessionId {
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
  return source.id
}

function createTarget(ctx: Context): ReturnType<AgentLoop['create']> {
  return ctx.agentLoop.create(SessionId('target'), { provider: 'mock', model: 'mock' }, { cwd: '/work' })
}

function assertSnapshotBeforeDirect(messages: GenerateOptions['messages']): void {
  const snapshotIndex = messages.findIndex(message =>
    message.role === 'user' && message.source.kind === 'session-reference')
  const directIndex = messages.findLastIndex(message =>
    message.role === 'user' && message.source.kind === 'user')
  expect(snapshotIndex).toBeGreaterThanOrEqual(0)
  expect(directIndex).toBe(snapshotIndex + 1)
}

describe('session-reference admission in the real agent loop', () => {
  it('sends the snapshot immediately before the readable followup message', async () => {
    const { ctx, adapter } = await harness()
    const sourceId = appendSourceConversation(ctx)
    const target = createTarget(ctx)
    target.followup(createUserMessage({
      content: [{
        type: 'text',
        text: `交接 ${formatSessionReferenceMention({ sessionId: sourceId, label: '源' })} 请继续`,
      }],
      source: { kind: 'user' },
    }))
    await target.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    assertSnapshotBeforeDirect(adapter.requests[0]!.messages)
  })

  it('sends the snapshot before a steering message claimed while the target is running', async () => {
    const { ctx, adapter } = await harness([toolCallResponse(), textResponse('steering done')])
    const sourceId = appendSourceConversation(ctx)
    const target = createTarget(ctx)
    target.followup(createUserMessage({
      content: [{ type: 'text', text: 'run the echo tool' }],
      source: { kind: 'user' },
    }))
    while (adapter.requests.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    target.steer(createUserMessage({
      content: [{
        type: 'text',
        text: `继续参考 ${formatSessionReferenceMention({ sessionId: sourceId, label: '源' })}`,
      }],
      source: { kind: 'user' },
    }))
    await target.whenIdle()

    expect(adapter.requests.length).toBeGreaterThanOrEqual(2)
    const referenceRequest = adapter.requests.find(request =>
      request.messages.some(message => message.source.kind === 'session-reference'))
    expect(referenceRequest).toBeDefined()
    assertSnapshotBeforeDirect(referenceRequest!.messages)
  })
})
