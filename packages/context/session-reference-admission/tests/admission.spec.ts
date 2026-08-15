import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { createMessage, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SessionReferenceResolver, {
  formatSessionReferenceMention,
  type SessionReferenceErrorCode,
} from '@deepseek-ai/dsh-session-reference'
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

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(TestSessionQueryEngine)
  await ctx.plugin(SessionReferenceResolver)
  await ctx.plugin(admission)
  return ctx
}

function fakeAgent(session: Session): Agent {
  return { id: session.id, session } as Agent
}

function appendConversation(session: Session): void {
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'source user' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'source assistant' }],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
}

function textOf(message: UserMessage): string {
  return message.content
    .flatMap(block => block.type === 'text' ? [block.text] : [])
    .join('\n')
}

const SIGNAL = new AbortController().signal

async function fire(ctx: Context, agent: Agent, messages: UserMessage[]) {
  return agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages, turn: 1, step: 1, signal: SIGNAL },
    () => Promise.resolve({ kind: 'enter' as const, messages }),
  )
}

function expectCode(code: SessionReferenceErrorCode): Error {
  return expect.objectContaining({ code }) as Error
}

describe('session-reference admission', () => {
  it('returns the original decision object when no direct message has a mention', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'))
    const plain = createUserMessage({
      content: [{ type: 'text', text: 'ordinary message' }],
      source: { kind: 'user' },
    })
    const decision = await fire(ctx, fakeAgent(target), [plain])
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages).toHaveLength(1)
    expect(decision.messages[0]).toBe(plain)
  })

  it('places the snapshot before a rewritten direct message and preserves id/source', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'))
    const source = ctx.sessions.create(SessionId('source'))
    appendConversation(source)
    const direct = createUserMessage({
      content: [{ type: 'text', text: `交接 ${formatSessionReferenceMention({ sessionId: source.id, label: '源' })} 请继续` }],
      source: { kind: 'user' },
    })
    const decision = await fire(ctx, fakeAgent(target), [direct])
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages).toHaveLength(2)
    const [snapshot, rewritten] = decision.messages as [UserMessage, UserMessage]
    expect(snapshot.source.kind).toBe('session-reference')
    expect(snapshot.id).not.toBe(direct.id)
    expect(rewritten.id).toBe(direct.id)
    expect(rewritten.source).toEqual(direct.source)
    expect(textOf(rewritten)).toContain('@源')
    expect(textOf(rewritten)).not.toContain('dsh-session:')
    expect(textOf(snapshot)).toContain('Referenced sessions')
  })

  it('never scans plugin or session-reference messages', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'))
    const source = ctx.sessions.create(SessionId('source'))
    const mention = formatSessionReferenceMention({ sessionId: source.id, label: '源' })
    const pluginMessage = createUserMessage({
      content: [{ type: 'text', text: `plugin text ${mention}` }],
      source: { kind: 'plugin', plugin: 'test' },
    })
    const decision = await fire(ctx, fakeAgent(target), [pluginMessage])
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages).toHaveLength(1)
    expect(decision.messages[0]).toBe(pluginMessage)
  })

  it('throws on a malformed explicit mention without emitting partial context', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'))
    const malformed = createUserMessage({
      content: [{ type: 'text', text: 'see @[bad](dsh-session:%%%)' }],
      source: { kind: 'user' },
    })
    await expect(fire(ctx, fakeAgent(target), [malformed]))
      .rejects.toThrow(expectCode('SESSION_REFERENCE_INVALID_REFERENCE'))
  })

  it('throws when a valid reference cannot be read', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'))
    const missing = createUserMessage({
      content: [{ type: 'text', text: formatSessionReferenceMention({ sessionId: SessionId('missing'), label: '缺' }) }],
      source: { kind: 'user' },
    })
    await expect(fire(ctx, fakeAgent(target), [missing]))
      .rejects.toThrow(expectCode('SESSION_REFERENCE_READ_FAILED'))
  })
})
