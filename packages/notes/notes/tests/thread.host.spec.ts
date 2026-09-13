/**
 * Thread attribution. A material's thread is each of its own user messages plus
 * everything up to the next user message, so a follow-up asked long after the
 * first analysis still lands in the right thread.
 */
import { describe, expect, it } from 'vitest'
import { attributeThread } from '../src/thread.ts'

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
