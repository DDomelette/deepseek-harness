import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { BatchSender } from '../src/sender.ts'
import type { UsageRow } from '@deepseek-ai/dsh-usage-telemetry/src/schema.ts'

let server: Server | undefined
afterEach(async () => { await new Promise<void>((resolve) => { server?.close(() => { resolve() }) }) })

function listen(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
      req.on('end', () => { handler(req, res, body) })
    })
    server.listen(0, '127.0.0.1', () => { resolve((server!.address() as { port: number }).port) })
  })
}

const rows: UsageRow[] = [{ v: 1, time: 1, sessionId: 's', inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }]

describe('BatchSender', () => {
  it('classifies an accepted batch and carries rootId', async () => {
    let seen: unknown
    const port = await listen((_req, res, body) => { seen = JSON.parse(body); res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, accepted: 1, duplicates: 0 })) })
    const sender = new BatchSender({ endpoint: `http://127.0.0.1:${port}/api/v1/dsh/usage`, token: '', sourceId: 'src', rootId: 'root:abc', requestTimeoutMs: 5000 })
    expect(await sender.send(rows, 'sha256:abc')).toEqual({ kind: 'accepted', accepted: 1 })
    expect(seen).toMatchObject({ sourceId: 'src', rootId: 'root:abc', batchId: 'sha256:abc', rows })
  })

  it('classifies 401 as permanent and 500 as retryable', async () => {
    const port = await listen((req, res) => {
      if (req.headers.authorization !== 'Bearer t') { res.writeHead(401).end('{}'); return }
      res.writeHead(500).end('{}')
    })
    const sender = new BatchSender({ endpoint: `http://127.0.0.1:${port}/api/v1/dsh/usage`, token: 't', sourceId: 'src', rootId: 'root:abc', requestTimeoutMs: 5000 })
    const retryable = await sender.send(rows, 'sha256:abc')
    expect(retryable.kind).toBe('retryable')
    if (retryable.kind === 'retryable') {
      expect(retryable.status).toBe(500)
      expect(typeof retryable.message).toBe('string')
    }
    const noAuth = new BatchSender({ endpoint: `http://127.0.0.1:${port}/api/v1/dsh/usage`, token: 'wrong', sourceId: 'src', rootId: 'root:abc', requestTimeoutMs: 5000 })
    const permanent = await noAuth.send(rows, 'sha256:abc')
    expect(permanent.kind).toBe('permanent')
    if (permanent.kind === 'permanent') {
      expect(permanent.status).toBe(401)
      expect(typeof permanent.message).toBe('string')
    }
  })

  it('sends a heartbeat envelope without rows or batchId', async () => {
    let seen: unknown
    const port = await listen((_req, res, body) => {
      seen = JSON.parse(body)
      res.writeHead(200).end(JSON.stringify({ ok: true, heartbeat: true }))
    })
    const sender = new BatchSender({ endpoint: `http://127.0.0.1:${port}/api/v1/dsh/usage`, token: '', sourceId: 'src', rootId: 'root:abc', requestTimeoutMs: 5000 })
    await sender.sendHeartbeat()
    expect(seen).toMatchObject({ sourceId: 'src', rootId: 'root:abc', heartbeat: true })
  })
})
