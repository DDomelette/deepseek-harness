/** Collected subprocess output preserves partial characters and consumes malformed bytes. */
import { describe, expect, it } from 'vitest'
import { readCompleteUtf8 } from '@deepseek-ai/dsh-subprocess'

describe('readCompleteUtf8', () => {
  it('resumes a fragmented character from the last complete byte offset', () => {
    const first = Buffer.from([0x61, 0xe2, 0x82])
    const read = readCompleteUtf8(first, 0)
    expect(read).toEqual({ text: 'a', end: 1 })
    const completed = Buffer.concat([first, Buffer.from([0xac])])
    expect(readCompleteUtf8(completed, read.end)).toEqual({ text: '€', end: 4 })
  })

  it.each([0xc0, 0xc1, 0xf5, 0xff])('consumes invalid lead byte %i without waiting for another chunk', (byte) => {
    expect(readCompleteUtf8(Buffer.from([byte]), 0)).toEqual({ text: '�', end: 1 })
  })

  it('consumes a window containing only orphaned continuation bytes', () => {
    expect(readCompleteUtf8(Buffer.from([0x80, 0xbf]), 0)).toEqual({ text: '��', end: 2 })
  })

  it('returns an empty read for an empty or fully consumed window', () => {
    expect(readCompleteUtf8(Buffer.alloc(0), 0)).toEqual({ text: '', end: 0 })
    expect(readCompleteUtf8(Buffer.from('done'), 4)).toEqual({ text: '', end: 4 })
  })

  it.each([
    [0xc2],
    [0xe2, 0x82],
    [0xf0, 0x9f, 0x92],
  ])('retains an incomplete sequence %j', (...bytes) => {
    expect(readCompleteUtf8(Buffer.from(bytes), 0)).toEqual({ text: '', end: 0 })
  })
})
