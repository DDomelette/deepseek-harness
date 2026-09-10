import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { appendFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Config, apply } from '@deepseek-ai/dsh-usage-exporter'

let server: Server | undefined
const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  if (server !== undefined) await new Promise<void>((resolve) => { server!.close(() => { resolve() }) })
  server = undefined
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const ROW = { v: 1, time: 1, sessionId: 's', model: 'm', inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

describe('usage-exporter apply', () => {
  it('pushes appended rows and advances the cursor', async () => {
    const received: Array<{ batchId: string; rows: unknown[] }> = []
    const port = await new Promise<number>((resolve) => {
      server = createServer((req: IncomingMessage, res: ServerResponse) => {
        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
        req.on('end', () => {
          received.push(JSON.parse(body) as { batchId: string; rows: unknown[] })
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, accepted: received.at(-1)!.rows.length, duplicates: 0 }))
        })
      })
      server.listen(0, '127.0.0.1', () => { resolve((server!.address() as { port: number }).port) })
    })
    const root = await mkdtemp(join(tmpdir(), 'usage-exporter-apply-'))
    roots.push(root)
    await mkdir(join(root, 'telemetry'), { recursive: true })
    const ctx = new Context()
    contexts.push(ctx)
    const fiber = ctx.plugin(
      { name: 'usage-exporter', inject: [] as never, apply },
      Config({ endpoint: `http://127.0.0.1:${port}/api/v1/dsh/usage`, telemetryRoot: join(root, 'telemetry'), cursorPath: join(root, 'cursor.json'), pollIntervalMs: 250 } as never),
    )
    await fiber.await()
    const cursorPath = join(root, 'cursor.json')
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(cursorPath, 'utf8'))).toEqual({ version: 1, files: {} })
    })
    const file = join(root, 'telemetry', 'usage-2026-08-16.jsonl')
    const line = JSON.stringify(ROW) + '\n'
    await appendFile(file, line)
    await vi.waitFor(() => { expect(received).toHaveLength(1) }, { timeout: 5000 })
    expect(received[0]!.rows).toEqual([ROW])

    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(cursorPath, 'utf8'))).toEqual({
        version: 1, files: { [file]: { offset: Buffer.byteLength(line) } },
      })
    })
  })
})
