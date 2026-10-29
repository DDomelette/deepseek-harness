import { afterEach, describe, expect, it, vi } from 'vitest'
import { BatchSender } from '../src/sender.ts'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

const endpoint = 'https://usage.example.invalid/ingest'
const options = { endpoint, token: '', sourceId: 'test-source', rootId: 'root:test', requestTimeoutMs: 500 }

describe('BatchSender failures', () => {
  it('recognizes duplicate ingestion without asking the caller to resend', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true, duplicates: 2 }))
    expect(await new BatchSender(options).send([], 'batch:test')).toEqual({ kind: 'duplicate', duplicates: 2 })
    expect(request).toHaveBeenCalledExactlyOnceWith(endpoint, expect.objectContaining({ method: 'POST' }))
  })

  it.each(['', 'not JSON', 'null', '1', '{"ok":true}', '{"ok":false}'])('refuses a malformed success response %j', async (body) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body))
    expect(await new BatchSender(options).send([], 'batch:test')).toEqual({
      kind: 'permanent', status: 200, message: body || 'malformed success body',
    })
  })

  it('classifies a response whose body stream failed', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('stream disconnected')) } })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 500 }))
    expect(await new BatchSender(options).sendHeartbeat()).toEqual({ kind: 'retryable', status: 500, message: '' })
  })

  it.each([new Error('connection lost'), 'connection lost'])('classifies transport rejection %j', async (error) => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(error)
    expect(await new BatchSender(options).sendHeartbeat()).toEqual({ kind: 'retryable', message: 'connection lost' })
  })

  it('aborts a request at its deadline and clears the timer after settlement', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      signal = init!.signal!
      return new Promise((_resolve, reject) => {
        signal!.addEventListener('abort', () => {
          // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Fetch preserves arbitrary AbortSignal reasons.
          reject(signal!.reason)
        }, { once: true })
      })
    })
    const pending = new BatchSender(options).sendHeartbeat()
    await vi.advanceTimersByTimeAsync(500)
    expect(signal?.aborted).toBe(true)
    expect((await pending).kind).toBe('retryable')
    expect(vi.getTimerCount()).toBe(0)
  })
})
