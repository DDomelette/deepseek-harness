import { describe, expect, it } from 'vitest'
import { serializeRow, usageRowSchema, USAGE_ROW_VERSION } from '../src/schema.ts'

describe('usage row schema v1', () => {
  it('serializes a full row with the frozen key order', () => {
    const line = serializeRow({
      v: USAGE_ROW_VERSION,
      time: 1786641087069,
      sessionId: 'session-1',
      cwd: 'D:\\Deepseek_Monitor',
      model: 'deepseek-v4-pro',
      inputTokens: 1404,
      outputTokens: 1089,
      cacheReadTokens: 46592,
      cacheWriteTokens: 0,
    })
    expect(line).toBe('{"v":1,"time":1786641087069,"sessionId":"session-1","cwd":"D:\\\\Deepseek_Monitor","model":"deepseek-v4-pro","inputTokens":1404,"outputTokens":1089,"cacheReadTokens":46592,"cacheWriteTokens":0}')
  })

  it('omits optional cwd/model keys entirely', () => {
    const line = serializeRow({
      v: USAGE_ROW_VERSION,
      time: 1,
      sessionId: 's',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    expect(line).toBe('{"v":1,"time":1,"sessionId":"s","inputTokens":0,"outputTokens":0,"cacheReadTokens":0,"cacheWriteTokens":0}')
  })

  it('rejects unknown keys and negative/float tokens', () => {
    expect(() => usageRowSchema.parse({ v: 1, time: 1, sessionId: 's', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, extra: true })).toThrow()
    expect(() => usageRowSchema.parse({ v: 1, time: 1, sessionId: 's', inputTokens: -1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toThrow()
    expect(() => usageRowSchema.parse({ v: 1, time: 1, sessionId: 's', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0.5 })).toThrow()
  })

  it('rejects versions other than 1', () => {
    expect(() => usageRowSchema.parse({ v: 2, time: 1, sessionId: 's', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toThrow()
  })

  it('rejects unsafe integers (>= 2**53) for time and every token field, matching the consumer window', () => {
    const base = { v: 1, time: 1, sessionId: 's', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    for (const field of ['time', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
      expect(() => usageRowSchema.parse({ ...base, [field]: 2 ** 53 })).toThrow()
    }
  })

  it('accepts Number.MAX_SAFE_INTEGER for time and every token field', () => {
    const row = {
      v: 1,
      time: Number.MAX_SAFE_INTEGER,
      sessionId: 's',
      inputTokens: Number.MAX_SAFE_INTEGER,
      outputTokens: Number.MAX_SAFE_INTEGER,
      cacheReadTokens: Number.MAX_SAFE_INTEGER,
      cacheWriteTokens: Number.MAX_SAFE_INTEGER,
    }
    expect(() => usageRowSchema.parse(row)).not.toThrow()
  })

  it('rejects NaN and Infinity for time and token fields', () => {
    const base = { v: 1, time: 1, sessionId: 's', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    for (const field of ['time', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
      expect(() => usageRowSchema.parse({ ...base, [field]: NaN })).toThrow()
      expect(() => usageRowSchema.parse({ ...base, [field]: Infinity })).toThrow()
    }
  })

  it('serializes newlines, non-ASCII and emoji in string fields as a single physical line', () => {
    const line = serializeRow({
      v: USAGE_ROW_VERSION,
      time: 1,
      sessionId: 's',
      cwd: 'D:\\cwd with\nlinebreak',
      model: '模型-🚀',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    expect(line).not.toContain('\n')
    expect(line).toContain('\\n')
    const parsed = usageRowSchema.parse(JSON.parse(line))
    expect(parsed.cwd).toBe('D:\\cwd with\nlinebreak')
    expect(parsed.model).toBe('模型-🚀')
  })
})
