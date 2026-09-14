/**
 * Turn outcomes: which user messages one turn carried, read back from the log,
 * and how its closing event leaves the materials that carried them.
 */
import { describe, expect, it } from 'vitest'
import { turnMessages, turnOutcome } from '../src/turns.ts'

/** One session event, as the structural reading sees it. */
interface Event {
  readonly seq: number
  readonly type: string
  readonly data?: unknown
}

/** One turn boundary. */
const boundary = (seq: number, type: 'turn/start' | 'turn/end', turn: number, reason?: unknown): Event => ({
  seq,
  type,
  data: reason === undefined ? { turn } : { turn, reason },
})

/** One submitted user message. */
const submitted = (seq: number, id: string): Event => ({
  seq,
  type: 'user/message',
  data: { id, role: 'user', content: [{ type: 'text', text: 'body' }] },
})

/** Two turns of one conversation, the second carrying two messages. */
const log: Event[] = [
  boundary(0, 'turn/start', 1),
  submitted(1, 'a1'),
  { seq: 2, type: 'assistant/message', data: { message: { role: 'assistant', content: [] } } },
  boundary(3, 'turn/end', 1, { kind: 'completed' }),
  boundary(4, 'turn/start', 2),
  submitted(5, 'a2'),
  submitted(6, 'a3'),
  boundary(7, 'turn/end', 2, { kind: 'completed' }),
]

describe('turn messages', () => {
  it('reads the messages one turn carried', () => {
    expect(turnMessages(log, 1)).toEqual(['a1'])
    expect(turnMessages(log, 2)).toEqual(['a2', 'a3'])
  })

  it('sorts an out-of-order log before reading it', () => {
    expect(turnMessages([...log].reverse(), 2)).toEqual(['a2', 'a3'])
  })

  it('reads nothing for a turn that carried no identified message', () => {
    const withoutIds: Event[] = [
      boundary(0, 'turn/start', 1),
      { seq: 1, type: 'user/message', data: { role: 'user', content: [] } },
      { seq: 2, type: 'user/message', data: { id: 7, role: 'user', content: [] } },
      boundary(3, 'turn/end', 1, { kind: 'completed' }),
    ]

    expect(turnMessages(withoutIds, 1)).toEqual([])
  })

  it('keeps a later turn out of an earlier one', () => {
    // A turn's own range ends at its closing event, so an unanswered turn that
    // follows it cannot contribute its messages.
    const open: Event[] = [
      boundary(0, 'turn/start', 1),
      submitted(1, 'a1'),
      boundary(2, 'turn/end', 1, { kind: 'completed' }),
      boundary(3, 'turn/start', 2),
      submitted(4, 'a2'),
    ]

    expect(turnMessages(open, 1)).toEqual(['a1'])
  })

  it('counts nothing for a boundary that carries no turn number', () => {
    const anonymous: Event[] = [
      { seq: 0, type: 'turn/start', data: {} },
      submitted(1, 'a1'),
    ]

    expect(turnMessages(anonymous, 1)).toEqual([])
  })
})

describe('turn outcome', () => {
  it('reads a completed turn as answered', () => {
    expect(turnOutcome({ turn: 1, reason: { kind: 'completed' } }))
      .toEqual({ answered: true, reason: null })
  })

  it('carries the failure message of an errored turn', () => {
    expect(turnOutcome({ turn: 1, reason: { kind: 'error', error: { message: 'socket closed', code: 'x' } } }))
      .toEqual({ answered: false, reason: 'socket closed' })
  })

  it('names an errored turn that carries no message', () => {
    expect(turnOutcome({ turn: 1, reason: { kind: 'error', error: {} } }))
      .toEqual({ answered: false, reason: 'the model call failed' })
  })

  it('names every other ending by its kind', () => {
    expect(turnOutcome({ turn: 1, reason: { kind: 'aborted', reason: {} } }))
      .toEqual({ answered: false, reason: 'the turn ended: aborted' })
  })

  it('reports an unreadable payload as an ended turn', () => {
    expect(turnOutcome(undefined)).toEqual({ answered: false, reason: 'the turn ended' })
    expect(turnOutcome({ turn: 1, reason: 'nonsense' })).toEqual({ answered: false, reason: 'the turn ended' })
    expect(turnOutcome({ turn: 1, reason: { kind: 7 } })).toEqual({ answered: false, reason: 'the turn ended' })
  })
})
