import { createServer, type Server } from 'node:http'
import { appendFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Config, apply } from '@deepseek-ai/dsh-usage-exporter'

let server: Server | undefined
afterEach(async () => { await new Promise<void>(resolve => server?.close(() => resolve())) })

const ROW = { v: 1, time: 1, sessionId: 's', model: 'm', inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

describe('usage-exporter apply', () => {
  it('pushes appended rows and advances the cursor', async () => {
    const received: Array<{ batchId: string; rows: unknown[] }> = []
    const port = await new Promise<number>((resolve) => {
      server = createServer((_req, res) => {
        let body = ''
        _req.on('data', (chunk) => { body += chunk })
        _req.on('end', () => {
          received.push(JSON.parse(body))
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, accepted: received.at(-1)!.rows.length, duplicates: 0 }))
        })
      })
      server.listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port))
    })
    const root = await mkdtemp(join(tmpdir(), 'usage-exporter-apply-'))
    await mkdir(join(root, 'telemetry'), { recursive: true })
    const ctx = new Context()
    ctx.logger.warn = vi.fn() as never
    const fiber = ctx.plugin(
      { name: 'usage-exporter', inject: [] as never, apply },
      Config({ endpoint: `http://127.0.0.1:${port}/api/v1/dsh/usage`, telemetryRoot: join(root, 'telemetry'), cursorPath: join(root, 'cursor.json'), pollIntervalMs: 250 } as never),
    )
    await fiber.await()
    await appendFile(join(root, 'telemetry', 'usage-2026-08-16.jsonl'), JSON.stringify(ROW) + '\n')
    await vi.waitFor(() => { expect(received).toHaveLength(1) }, { timeout: 5000 })
    expect(received[0]!.rows).toEqual([ROW])

    await fiber.dispose()
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
})
