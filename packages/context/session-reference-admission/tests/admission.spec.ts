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
  static readonly failRead = new Set<string>()

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

  override async readSurface(
    sessionId: Parameters<SessionQueryEngine['readSurface']>[0],
  ): ReturnType<SessionQueryEngine['readSurface']> {
    if (TestSessionQueryEngine.failRead.has(sessionId)) throw new Error(`read failed for ${String(sessionId)}`)
    return super.readSurface(sessionId)
  }
}

async function harness(failRead: readonly string[] = []): Promise<Context> {
  const ctx = new Context()
  TestSessionQueryEngine.failRead.clear()
  for (const id of failRead) TestSessionQueryEngine.failRead.add(id)
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

async function fire(ctx: Context, agent: Agent, messages: UserMessage[], signal = new AbortController().signal) {
  return agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages, turn: 1, step: 1, signal },
    () => Promise.resolve({ kind: 'enter' as const, messages }),
  )
}

function expectCode(code: SessionReferenceErrorCode): Error {
  return expect.objectContaining({ code }) as Error
}

function createTarget(ctx: Context, id = 'target', cwd = '/work'): Session {
  return ctx.sessions.create(SessionId(id), { meta: { cwd } })
}

function createSource(ctx: Context, id: string, cwd = '/work'): Session {
  const source = ctx.sessions.create(SessionId(id), { meta: { cwd } })
  appendConversation(source)
  return source
}

describe('session-reference admission', () => {
  it('returns the original decision object when no direct message has a mention', async () => {
    const ctx = await harness()
    const target = createTarget(ctx)
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
    const target = createTarget(ctx)
    const source = createSource(ctx, 'source')
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

  it('keeps non-text blocks in place while replacing the text block', async () => {
    const ctx = await harness()
    const target = createTarget(ctx)
    const source = createSource(ctx, 'source')
    const direct = createUserMessage({
      content: [
        { type: 'reasoning', text: 'keep this reasoning block' },
        { type: 'text', text: `交接 ${formatSessionReferenceMention({ sessionId: source.id, label: '源' })} 请继续` },
      ],
      source: { kind: 'user' },
    })
    const decision = await fire(ctx, fakeAgent(target), [direct])
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages).toHaveLength(2)
    const rewritten = decision.messages[1] as UserMessage
    expect(rewritten.content).toEqual([
      { type: 'reasoning', text: 'keep this reasoning block' },
      { type: 'text', text: '交接 @源 请继续' },
    ])
  })

  it('collects multiple references into one snapshot before the direct message', async () => {
    const ctx = await harness()
    const target = createTarget(ctx)
    const one = createSource(ctx, 'one')
    const two = createSource(ctx, 'two')
    const direct = createUserMessage({
      content: [{
        type: 'text',
        text: `${formatSessionReferenceMention({ sessionId: one.id, label: '一' })} ${formatSessionReferenceMention({ sessionId: two.id, label: '二' })}`,
      }],
      source: { kind: 'user' },
    })
    const decision = await fire(ctx, fakeAgent(target), [direct])
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages).toHaveLength(2)
    const [snapshot, rewritten] = decision.messages as [UserMessage, UserMessage]
    expect(textOf(snapshot)).toContain(one.id)
    expect(textOf(snapshot)).toContain(two.id)
    expect(textOf(rewritten)).toBe('@一 @二')
  })

  it('rejects more than three distinct sources', async () => {
    const ctx = await harness()
    const target = createTarget(ctx)
    const ids = ['a', 'b', 'c', 'd']
    for (const id of ids) createSource(ctx, id)
    const direct = createUserMessage({
      content: [{
        type: 'text',
        text: ids.map(id => formatSessionReferenceMention({ sessionId: SessionId(id), label: id })).join(' '),
      }],
      source: { kind: 'user' },
    })
    await expect(fire(ctx, fakeAgent(target), [direct]))
      .rejects.toThrow(expectCode('SESSION_REFERENCE_TOO_MANY'))
  })

  it('never scans plugin or session-reference messages', async () => {
    const ctx = await harness()
    const target = createTarget(ctx)
    const source = createSource(ctx, 'source')
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
    const target = createTarget(ctx)
    const malformed = createUserMessage({
      content: [{ type: 'text', text: 'see @[bad](dsh-session:%%%)' }],
      source: { kind: 'user' },
    })
    await expect(fire(ctx, fakeAgent(target), [malformed]))
      .rejects.toThrow(expectCode('SESSION_REFERENCE_INVALID_REFERENCE'))
  })

  it('rejects a valid reference whose source is outside the target workspace', async () => {
    const ctx = await harness()
    const target = createTarget(ctx)
    const other = createSource(ctx, 'other-cwd', '/elsewhere')
    const direct = createUserMessage({
      content: [{ type: 'text', text: formatSessionReferenceMention({ sessionId: other.id, label: '异区' }) }],
      source: { kind: 'user' },
    })
    await expect(fire(ctx, fakeAgent(target), [direct]))
      .rejects.toThrow(expectCode('SESSION_REFERENCE_INVALID_REFERENCE'))
  })

  it('throws when a same-workspace source cannot be read', async () => {
    const ctx = await harness(['broken'])
    const target = createTarget(ctx)
    const broken = ctx.sessions.create(SessionId('broken'), { meta: { cwd: '/work' } })
    const direct = createUserMessage({
      content: [{ type: 'text', text: formatSessionReferenceMention({ sessionId: broken.id, label: '坏' }) }],
      source: { kind: 'user' },
    })
    await expect(fire(ctx, fakeAgent(target), [direct]))
      .rejects.toThrow(expectCode('SESSION_REFERENCE_READ_FAILED'))
  })

  it('preserves downstream listener context after rewriting', async () => {
    const ctx = await harness()
    const target = createTarget(ctx)
    const source = createSource(ctx, 'source')
    const extra = createUserMessage({
      content: [{ type: 'text', text: 'downstream context' }],
      source: { kind: 'plugin', plugin: 'downstream' },
    })
    ctx.on('agent/pre-step', async (_payload, next) => {
      const decision = await next()
      if (decision.kind !== 'enter') return decision
      return { kind: 'enter' as const, messages: [...decision.messages, extra] }
    })
    const direct = createUserMessage({
      content: [{ type: 'text', text: formatSessionReferenceMention({ sessionId: source.id, label: '源' }) }],
      source: { kind: 'user' },
    })
    const decision = await fire(ctx, fakeAgent(target), [direct])
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages).toHaveLength(3)
    expect(decision.messages[0]?.source.kind).toBe('session-reference')
    expect(decision.messages[1]?.id).toBe(direct.id)
    expect(decision.messages[2]).toBe(extra)
  })
})
