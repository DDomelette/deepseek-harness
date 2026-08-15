import { describe, expect, it } from 'vitest'
import { Config, name, apply } from '@deepseek-ai/dsh-usage-exporter'
import { Context } from '@deepseek-ai/cordis'

describe('usage-exporter package surface', () => {
  it('exports the plugin name', () => {
    expect(name).toBe('usage-exporter')
  })

  it('applies defaults and keeps the provided endpoint', () => {
    const resolved = Config({ endpoint: 'http://127.0.0.1:3900/api/v1/dsh/usage' } as never)
    expect(resolved).toMatchObject({
      endpoint: 'http://127.0.0.1:3900/api/v1/dsh/usage',
      token: '',
      sourceId: '',
      pollIntervalMs: 1000,
      maxBatchRows: 200,
      maxBatchBytes: 262144,
      requestTimeoutMs: 10_000,
      maxAttempts: 5,
      baseRetryMs: 1000,
      maxRetryMs: 30_000,
      heartbeatIntervalMs: 60_000,
      startFrom: 'end',
    })
  })

  it('rejects an out-of-range batch limit', () => {
    expect(() => Config({ endpoint: 'https://example.test/x', maxBatchRows: 0 } as never)).toThrow()
  })

  it('apply is a stub until the loop task lands', async () => {
    const ctx = new Context()
    await expect(apply(ctx, Config({ endpoint: 'https://example.test/x' } as never))).rejects.toThrow('not implemented')
  })
})
