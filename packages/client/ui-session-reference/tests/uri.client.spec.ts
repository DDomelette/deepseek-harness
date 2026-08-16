// @vitest-environment jsdom
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it } from 'vitest'
import { encodeSessionReferenceUri, formatSessionReferenceMention } from '../src/client/uri.ts'

const sid = (id: string): SessionId => id as SessionId

describe('browser session-reference URI encoder', () => {
  it.each([
    ['session-123', 'InNlc3Npb24tMTIzIg'],
    ['会话-任务 交接', 'IuS8muivnS3ku7vliqEg5Lqk5o6lIg'],
    ['a"b\\c', 'ImFcImJcXGMi'],
    ['line1\nline2', 'ImxpbmUxXG5saW5lMiI'],
    ['x/y/z', 'IngveS96Ig'],
  ] as const)('encodes %j exactly like the host encoder', (id, payload) => {
    expect(encodeSessionReferenceUri(sid(id))).toBe(`dsh-session:${payload}`)
  })

  it('escapes label brackets and backslashes in the mention', () => {
    expect(formatSessionReferenceMention(sid('s-1'), '源]会话'))
      .toBe('@[源\\]会话](dsh-session:InMtMSI)')
  })
})
