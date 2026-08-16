// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import type {
  SessionId, SessionListState, SessionSummary,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ClientSessionContext, InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

const sid = (id: string): SessionId => id as SessionId

function summary(partial: Partial<SessionSummary> & { id: SessionId }): SessionSummary {
  return {
    displayTitle: partial.id,
    running: false,
    updatedAt: 0,
    blank: false,
    ...partial,
  } as SessionSummary
}

function sessionsWith(rows: SessionSummary[]) {
  const listeners = new Set<() => void>()
  const snapshot = (): SessionListState => ({
    ids: rows.map(row => row.id),
    byId: Object.fromEntries(rows.map(row => [row.id, row])) as SessionListState['byId'],
    current: rows[0]?.id,
    phase: 'ready',
  }) as unknown as SessionListState
  return {
    list: {
      getSnapshot: snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
  }
}

async function bench(rows: SessionSummary[]): Promise<InputTriggerSource> {
  const ctx = new Context()
  let captured: InputTriggerSource | undefined
  ctx.provide('inputTriggers', {
    registerSource: (source: InputTriggerSource) => {
      captured = source
      return () => {}
    },
  })
  ctx.provide('sessions', sessionsWith(rows))
  await ctx.plugin({ inject: [...inject], apply }).await()
  return captured!
}

const proj = (id: string): ClientSessionContext => ({ sessionId: sid(id) })

const req = (query: string) => ({
  query,
  position: 'inline' as const,
  signal: new AbortController().signal,
})

describe('ui-session-reference source', () => {
  it('declares its service edges', () => {
    expect(inject).toEqual(['inputTriggers', 'sessions'])
  })

  it('registers the ordered @ session source', async () => {
    const source = await bench([summary({ id: sid('current'), cwd: '/w', displayTitle: '当前' })])
    expect(source).toMatchObject({ trigger: '@', name: 'session', order: -1 })
  })

  it('filters strictly to the current cwd and excludes self, blank, and subagents', async () => {
    const rows = [
      summary({ id: sid('current'), cwd: '/w', displayTitle: '当前' }),
      summary({ id: sid('same'), cwd: '/w', displayTitle: '同区' }),
      summary({ id: sid('blank'), cwd: '/w', displayTitle: '空白', blank: true }),
      summary({ id: sid('child'), cwd: '/w', displayTitle: '子代理', origin: 'subagent' }),
      summary({ id: sid('other'), cwd: '/x', displayTitle: '异区' }),
    ]
    const source = await bench(rows)
    const candidates = await source.candidates(proj('current'), req(''))
    expect(candidates.map(item => item.name)).toEqual(['同区'])
  })

  it('matches query against title and id, caps at 50, and keeps list order', async () => {
    const rows = [summary({ id: sid('current'), cwd: '/w', displayTitle: '当前' })]
    for (let index = 0; index < 60; index++) {
      rows.push(summary({ id: sid(`s-${String(index).padStart(2, '0')}`), cwd: '/w', displayTitle: `任务 ${String(index)}` }))
    }
    const source = await bench(rows)
    const candidates = await source.candidates(proj('current'), req(''))
    expect(candidates).toHaveLength(50)
    expect(candidates[0]!.name).toBe('任务 0')
  })

  it('disambiguates duplicate titles with the session id description', async () => {
    const source = await bench([
      summary({ id: sid('current'), cwd: '/w', displayTitle: '当前' }),
      summary({ id: sid('a'), cwd: '/w', displayTitle: '同名' }),
      summary({ id: sid('b'), cwd: '/w', displayTitle: '同名' }),
    ])
    const candidates = await source.candidates(proj('current'), req('同名'))
    expect(candidates).toHaveLength(2)
    expect(candidates[0]!.description).toBe('a')
    expect(candidates[1]!.description).toBe('b')
  })

  it('picks a structured ReferenceInsert with the session id', async () => {
    const source = await bench([
      summary({ id: sid('current'), cwd: '/w', displayTitle: '当前' }),
      summary({ id: sid('source'), cwd: '/w', displayTitle: '交接源' }),
    ])
    const candidate = (await source.candidates(proj('current'), req('交接')))[0]!
    const outcome = source.onPick({
      candidate,
      session: proj('current'),
      position: 'inline',
      via: 'menu',
      span: { start: 0, end: 1, draftRev: 1 },
    })
    expect(outcome).toMatchObject({
      insert: {
        source: 'session',
        ref: 'source',
        label: '交接源',
        clipboardText: '@[交接源](dsh-session:InNvdXJjZSI)',
      },
    })
  })

  it('serializes the canonical mention and rejects early when the session left a ready list', async () => {
    const rows = [
      summary({ id: sid('current'), cwd: '/w', displayTitle: '当前' }),
      summary({ id: sid('source'), cwd: '/w', displayTitle: '交接源' }),
    ]
    const source = await bench(rows)
    await expect(source.codec!.serialize(sid('source'), new AbortController().signal))
      .resolves.toBe('@[交接源](dsh-session:InNvdXJjZSI)')

    rows[1] = summary({ id: sid('source'), cwd: '/w', displayTitle: '新标题' })
    await expect(source.codec!.serialize(sid('source'), new AbortController().signal))
      .resolves.toContain('新标题')

    rows.splice(1, 1)
    await expect(source.codec!.serialize(sid('source'), new AbortController().signal))
      .rejects.toThrow('会话引用已失效')
  })
})
