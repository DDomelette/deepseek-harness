/**
 * Thread attribution and projection. A material's thread is each of its own user
 * messages plus everything up to the next user message, so a follow-up asked
 * long after the first analysis still lands in the right thread; the projection
 * turns that into the rows the panel draws.
 */
import { describe, expect, it } from 'vitest'
import { attributeThread, projectThread } from '../src/thread.ts'

/** Minimal event shape the attribution reads; `data.id` mirrors `UserMessage.id`. */
interface Row {
  readonly seq: number
  readonly type: string
  readonly data?: { readonly id?: string }
}

const rows: Row[] = [
  { seq: 10, type: 'user/message', data: { id: 'a1' } },   // material A
  { seq: 11, type: 'assistant/message' },
  { seq: 20, type: 'user/message', data: { id: 'b1' } },   // material B
  { seq: 21, type: 'assistant/message' },
  { seq: 30, type: 'user/message', data: { id: 'a2' } },   // A follow-up, after B
  { seq: 31, type: 'tool/call' },
  { seq: 32, type: 'assistant/message' },
  { seq: 40, type: 'user/message', data: { id: 'b2' } },   // B follow-up
  { seq: 41, type: 'assistant/message' },
]

/** One event as the projection reads it: a sequence, a type, and a payload. */
interface Event {
  readonly seq: number
  readonly type: string
  readonly data?: unknown
}

/** One text part of a message. */
const text = (value: string): { type: string; text: string } => ({ type: 'text', text: value })

/** One collected screenshot, which carries no text. */
const image = (): { type: string; attachment: { attachmentId: string } } =>
  ({ type: 'image', attachment: { attachmentId: 'attachment-1' } })

/** One submitted user message, as the session logs it. */
const submitted = (seq: number, id: string, ...content: unknown[]): Event => ({
  seq, type: 'user/message', data: { id, role: 'user', content },
})

/** One assistant turn, which nests its message. */
const answered = (seq: number, ...content: unknown[]): Event => ({
  seq, type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content } },
})

describe('thread attribution', () => {
  it('keeps every non-contiguous segment belonging to one material', () => {
    expect(attributeThread(rows, ['a1', 'a2']).map(row => row.seq)).toEqual([10, 11, 30, 31, 32])
  })

  it('never leaks a neighbouring material into the thread', () => {
    expect(attributeThread(rows, ['b1']).map(row => row.seq)).toEqual([20, 21])
    expect(attributeThread(rows, ['b2']).map(row => row.seq)).toEqual([40, 41])
  })

  it('returns nothing for a material that never entered the session', () => {
    expect(attributeThread(rows, [])).toEqual([])
    expect(attributeThread(rows, ['never-sent'])).toEqual([])
  })

  it('stops at a user message carrying no identity, without attributing it', () => {
    const blank: Row[] = [{ seq: 50, type: 'user/message' }, { seq: 51, type: 'assistant/message' }]
    expect(attributeThread([...rows, ...blank], ['a1']).map(row => row.seq)).toEqual([10, 11])
  })

  it('sorts an out-of-order log before attributing it', () => {
    const shuffled: Row[] = [
      { seq: 11, type: 'assistant/message' },
      { seq: 30, type: 'user/message', data: { id: 'a2' } },
      { seq: 10, type: 'user/message', data: { id: 'a1' } },
    ]
    expect(attributeThread(shuffled, ['a1', 'a2']).map(row => row.seq)).toEqual([10, 11, 30])
  })
})

describe('thread projection', () => {
  it('draws the submission and the answer that follows it, in sequence order', () => {
    const log = [
      submitted(10, 'a1', text('body')),
      answered(11, text('answer')),
    ]

    expect(projectThread(log, ['a1'])).toEqual([
      { role: 'user', text: 'body', hasImage: false, seq: 10 },
      { role: 'assistant', text: 'answer', hasImage: false, seq: 11 },
    ])
  })

  it('joins a message\'s text parts with a blank line', () => {
    const log = [submitted(10, 'a1', text('first'), text('second'))]

    expect(projectThread(log, ['a1']))
      .toEqual([{ role: 'user', text: 'first\n\nsecond', hasImage: false, seq: 10 }])
  })

  it('keeps a screenshot submission, which carries no text of its own', () => {
    const log = [submitted(10, 'a1', image()), answered(11, text('answer'))]

    expect(projectThread(log, ['a1'])).toEqual([
      { role: 'user', text: '', hasImage: true, seq: 10 },
      { role: 'assistant', text: 'answer', hasImage: false, seq: 11 },
    ])
  })

  it('keeps the action template a screenshot was submitted under beside its image', () => {
    const log = [submitted(10, 'a1', text('translate:'), image())]

    expect(projectThread(log, ['a1']))
      .toEqual([{ role: 'user', text: 'translate:', hasImage: true, seq: 10 }])
  })

  it('draws a follow-up asked after another material was answered', () => {
    const log = [
      submitted(10, 'a1', text('first')),
      answered(11, text('answer one')),
      submitted(20, 'b1', text('other')),
      answered(21, text('answer two')),
      submitted(30, 'a2', text('why?')),
      answered(32, text('because')),
    ]

    expect(projectThread(log, ['a1', 'a2']).map(row => row.text))
      .toEqual(['first', 'answer one', 'why?', 'because'])
  })

  it('draws no row for a message that carries no text', () => {
    const log = [
      submitted(10, 'a1', text('body')),
      answered(11),
      { seq: 12, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'tool-call' }] } } },
    ]

    expect(projectThread(log, ['a1']).map(row => row.seq)).toEqual([10])
  })

  it('draws no row for a role the thread does not show', () => {
    const log = [
      submitted(10, 'a1', text('body')),
      { seq: 11, type: 'system/message', data: { turn: 1, step: 1, message: { role: 'system', content: [text('rules')] } } },
      { seq: 12, type: 'assistant/message', data: { message: { content: [text('no role')] } } },
    ]

    expect(projectThread(log, ['a1']).map(row => row.seq)).toEqual([10])
  })

  it('draws nothing for a payload that is not an object', () => {
    const log = [
      submitted(10, 'a1', text('body')),
      { seq: 11, type: 'assistant/message', data: 'nonsense' },
      { seq: 12, type: 'user/message', data: null },
    ]

    expect(projectThread(log, ['a1']).map(row => row.seq)).toEqual([10])
  })

  it('draws nothing for a message whose content is not a list', () => {
    const log = [
      submitted(10, 'a1', text('body')),
      { seq: 11, type: 'assistant/message', data: { message: { role: 'assistant', content: 'text' } } },
      {
        seq: 12,
        type: 'assistant/message',
        data: { message: { role: 'assistant', content: [null, { type: 'text' }, { type: 'text', text: 7 }] } },
      },
    ]

    expect(projectThread(log, ['a1']).map(row => row.seq)).toEqual([10])
  })
})
