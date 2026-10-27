/** Terminal jobs keep a byte cursor while their send operation becomes available. */
import { describe, expect, it } from 'vitest'
import type { TerminalSendOperation } from '@deepseek-ai/dsh-terminal'
import { sendSources } from '../src/background.ts'

describe('terminal job output', () => {
  it('keeps pending reads stationary and counts UTF-8 bytes after output appears', () => {
    let operation: TerminalSendOperation | undefined = undefined
    const source = sendSources(() => operation)[0]!
    expect(source.read(0)).toEqual({ text: '', nextOffset: 0, lossy: false })
    expect(source.read(0)).toEqual({ text: '', nextOffset: 0, lossy: false })
    const chunks = ['中', 'é']
    operation = {
      done: Promise.resolve({ viewport: '', waitReason: 'stdin_read', sessionStatus: { kind: 'running' }, truncated: false }),
      cancel: () => false,
      readOutput: () => ({ delta: chunks.shift() ?? '', truncated: false }),
    }
    expect(source.read(0)).toEqual({ text: '中', nextOffset: 3, lossy: false })
    expect(source.read(3)).toEqual({ text: 'é', nextOffset: 5, lossy: false })
    expect(source.read(5)).toEqual({ text: '', nextOffset: 5, lossy: false })
  })
})
