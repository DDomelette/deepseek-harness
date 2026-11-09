import { Readable } from 'node:stream'
import { ServerResponse, type IncomingMessage } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { bridge } from '../src/http-bridge.ts'
import { Peer } from '../src/peer.ts'

/** Create a response whose writable-end flag is controlled by the recorder methods. */
function responseRecorder(request: IncomingMessage): ServerResponse {
  const response = new ServerResponse(request)
  Object.defineProperty(response, 'writableEnded', { value: false, writable: true })
  return response
}

const PEER = new Peer(new Context(), { principal: { kind: 'owner' } })

describe('HTTP bridge abort', () => {
  it('destroys a declared-oversize request instead of draining it', async () => {
    const destroyed: true[] = []
    const request = Readable.from([]) as IncomingMessage
    Object.assign(request, {
      url: '/api/session.prompt',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '999999' },
      destroy: () => { destroyed.push(true) },
    })
    let status: number | undefined
    let headers: unknown
    const response = Object.assign(responseRecorder(request), {
      writableEnded: false,
      getHeader() { return undefined },
      writeHead(code: number, values?: unknown) { status = code; headers = values; return this },
      write() { return true },
      end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
    })

    await bridge(request, response, {
      requestBodyMode: () => 'buffered',
      fetch: () => { throw new Error('a rejected request must never reach the handler') },
    }, PEER, 1000)
    // The socket must not stay parked draining a body the client can trickle
    // at will after the rejection — same discipline as the chunked overrun.
    expect(status).toBe(413)
    expect(headers).toMatchObject({ connection: 'close' })
    expect(destroyed).toHaveLength(1)
  })

  it('refuses a client-framed body on a GET before the handler runs', async () => {
    const destroyed: true[] = []
    const request = Readable.from([Buffer.from('{"unexpected":true}')]) as IncomingMessage
    Object.assign(request, {
      url: '/api/file',
      method: 'GET',
      headers: { 'content-type': 'application/json', 'content-length': '18' },
      destroy: () => { destroyed.push(true) },
    })
    let status: number | undefined
    const response = Object.assign(responseRecorder(request), {
      writableEnded: false,
      getHeader() { return undefined },
      writeHead(code: number, values?: unknown) { status = code; headers = values; return this },
      write() { return true },
      end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
    })
    let headers: unknown

    await bridge(request, response, {
      requestBodyMode: () => 'none',
      fetch: () => { throw new Error('a bodyless route must never receive a framed body') },
    }, PEER)

    // Fetch forbids constructing a body-carrying GET, so the client's frame is
    // answered instead of turning into a TypeError no handler can see.
    expect(status).toBe(400)
    expect(headers).toMatchObject({ connection: 'close' })
    expect(destroyed).toHaveLength(1)
  })

  it('dispatches a bodyless route with a bodyless Request', async () => {
    const request = Readable.from([]) as IncomingMessage
    Object.assign(request, { url: '/api/file', method: 'HEAD', headers: {} })
    let status: number | undefined
    const response = Object.assign(responseRecorder(request), {
      writableEnded: false,
      getHeader() { return undefined },
      writeHead(code: number) { status = code; return this },
      write() { return true },
      end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
    })

    await bridge(request, response, {
      requestBodyMode: () => 'none',
      fetch: input => Promise.resolve(Response.json({
        method: input.method,
        body: input.body === null,
      })),
    }, PEER)

    expect(status).toBe(200)
  })

  it('forwards every Set-Cookie, keeping a renewal staged before dispatch', async () => {
    const request = Readable.from([]) as IncomingMessage
    Object.assign(request, {
      url: '/api/remote.mux',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    let status: number | undefined
    let headers: Record<string, unknown> | undefined
    const response = Object.assign(responseRecorder(request), {
      writableEnded: false,
      getHeader(name: string) { return name === 'set-cookie' ? ['staged=renewal; Path=/'] : undefined },
      writeHead(code: number, values?: Record<string, unknown>) { status = code; headers = values; return this },
      write() { return true },
      end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
    })

    await bridge(request, response, {
      requestBodyMode: () => 'buffered',
      fetch: () => Promise.resolve(new Response(null, {
        status: 200,
        headers: [['set-cookie', 'first=1; Path=/'], ['set-cookie', 'second=2; Path=/']],
      })),
    }, PEER)

    expect(status).toBe(200)
    // A repeated header cannot ride an object of single values: the staged
    // renewal and both response cookies reach the client, in that order.
    expect(headers?.['set-cookie']).toEqual([
      'staged=renewal; Path=/',
      'first=1; Path=/',
      'second=2; Path=/',
    ])
  })

  it('omits the cookie header when neither side sets one', async () => {
    const request = Readable.from([]) as IncomingMessage
    Object.assign(request, { url: '/api/remote.mux', method: 'POST', headers: {} })
    let headers: Record<string, unknown> | undefined
    const response = Object.assign(responseRecorder(request), {
      writableEnded: false,
      getHeader() { return undefined },
      writeHead(_code: number, values?: Record<string, unknown>) { headers = values; return this },
      write() { return true },
      end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
    })

    await bridge(request, response, {
      requestBodyMode: () => 'buffered',
      fetch: () => Promise.resolve(Response.json({ ok: true })),
    }, PEER)

    expect(headers?.['set-cookie']).toBeUndefined()
    expect(headers?.['content-type']).toBe('application/json')
  })

  it('aborts a pending native picker request when the browser disconnects', async () => {
    const body = JSON.stringify({
      type: 'client-request', rpcId: 'picker-1', method: 'directoryPicker/pick', payload: { args: {} },
    })
    const request = Readable.from([Buffer.from(body)]) as IncomingMessage
    Object.assign(request, {
      url: '/api/directoryPicker/pick',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })

    const response = Object.assign(responseRecorder(request), {
      writableEnded: false,
      getHeader() { return undefined },
      writeHead() { return this },
      write() { return true },
      end() { this.writableEnded = true; return this },
    })

    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => { resolveStarted = resolve })
    let carrierSignal: AbortSignal | undefined
    const pending = bridge(request, response, {
      requestBodyMode: () => 'buffered',
      fetch: async (input) => {
        const fetchRequest = input
        carrierSignal = fetchRequest.signal
        resolveStarted()
        if (!fetchRequest.signal.aborted) {
          await new Promise<void>((resolve) => {
            fetchRequest.signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
        }
        return Response.json({ aborted: fetchRequest.signal.aborted })
      },
    }, PEER, Number.MAX_SAFE_INTEGER)
    await started
    response.emit('close')
    await pending
    expect(carrierSignal?.aborted).toBe(true)
  })

  it.each(['write', 'backpressure'])('finishes a multipart response without further writes when the client closes during %s', async (phase) => {
    const request = Readable.from([]) as IncomingMessage
    Object.assign(request, { url: '/api/workspaceFiles/readBytes', method: 'GET', headers: {} })
    const body = new FormData()
    body.set('metadata', '{}')
    body.set('data', new Blob([new Uint8Array(16 * 1024 * 1024)]))
    const encoded = new Response(body)
    const bytes = new Uint8Array(await encoded.arrayBuffer())
    let offset = 0
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.length) { controller.close(); return }
        const end = Math.min(offset + 64 * 1024, bytes.length)
        controller.enqueue(bytes.slice(offset, end))
        offset = end
      },
      cancel,
    })
    let writes = 0
    let cleaningUp = false
    const response = Object.assign(responseRecorder(request), {
      destroyed: false,
      writableEnded: false,
      getHeader() { return undefined },
      writeHead() { return this },
      write() {
        writes++
        if (writes === 1) {
          const close = (): void => { response.destroyed = true; response.emit('close') }
          if (phase === 'write') close()
          else queueMicrotask(close)
        }
        return cleaningUp
      },
      end() { this.writableEnded = true; return this },
    })
    let settled = false
    const pending = bridge(request, response, {
      requestBodyMode: () => 'buffered',
      fetch: async () => new Response(stream, { headers: encoded.headers }),
    }, PEER).then(() => { settled = true })
    try {
      await expect.poll(() => settled).toBe(true)
      expect(writes).toBe(1)
      expect(cancel).toHaveBeenCalledOnce()
      expect(response.listenerCount('drain')).toBe(0)
    } finally {
      // Release a regressed bridge parked after the one close event.
      cleaningUp = true
      response.emit('drain')
      await pending
    }
  })

  it('discards bytes returned after the client disconnects', async () => {
    const request = Readable.from([]) as IncomingMessage
    Object.assign(request, { url: '/api/workspaceFiles/readBytes', method: 'GET', headers: {} })
    const response = Object.assign(responseRecorder(request), {
      destroyed: false,
      writableEnded: false,
      getHeader() { return undefined },
      writeHead() { return this },
      write() { throw new Error('a disconnected response must not receive bytes') },
      end() { this.writableEnded = true; return this },
    })
    const started = Promise.withResolvers<undefined>()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({
      start(value) { controller = value },
      pull() { started.resolve(undefined) },
    })
    const pending = bridge(request, response, {
      requestBodyMode: () => 'buffered',
      fetch: async () => new Response(body),
    }, PEER)
    await started.promise
    response.emit('close')
    controller.enqueue(Uint8Array.of(1))
    controller.close()
    await pending
  })

  it('streams a declared 2.19 GiB request before the body ends and bypasses the JSON buffer cap', async () => {
    const request = new Readable({ read() {} }) as IncomingMessage
    Object.assign(request, {
      url: '/api/session/uploadFileBinary?sessionId=s1',
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(Math.ceil(2.19 * 1024 ** 3)),
      },
    })
    let status: number | undefined
    const responseBytes: Uint8Array[] = []
    const response = Object.assign(responseRecorder(request), {
      writableEnded: false,
      getHeader() { return undefined },
      writeHead(code: number) { status = code; return this },
      write(chunk: Uint8Array) { responseBytes.push(chunk); return true },
      end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
    })

    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => { resolveStarted = resolve })
    const received: Uint8Array[] = []
    const pending = bridge(request, response, {
      requestBodyMode: () => 'streaming',
      fetch: async (input) => {
        resolveStarted()
        if (input.body === null) throw new Error('streaming request lost its body')
        for await (const chunk of input.body) received.push(chunk)
        return new Response('stored')
      },
    }, PEER, 1)

    await started
    expect(received).toEqual([])
    request.push(Buffer.from([1, 2]))
    request.push(Buffer.from([3, 4]))
    request.push(null)
    await pending
    expect(status).toBe(200)
    expect(received).toEqual([Uint8Array.of(1, 2), Uint8Array.of(3, 4)])
    expect(Buffer.concat(responseBytes).toString()).toBe('stored')
  })

  it('closes an unread streaming request after returning an early validation response', async () => {
    const destroyed: true[] = []
    const request = new Readable({ read() {} }) as IncomingMessage
    Object.assign(request, {
      url: '/api/session/uploadFileBinary',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      destroy: () => { destroyed.push(true) },
    })
    let status: number | undefined
    let headers: unknown
    const response = Object.assign(responseRecorder(request), {
      writableEnded: false,
      getHeader() { return undefined },
      writeHead(code: number, values?: unknown) { status = code; headers = values; return this },
      write() { return true },
      end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
    })

    await bridge(request, response, {
      requestBodyMode: () => 'streaming',
      fetch: () => Promise.resolve(new Response(null, { status: 415 })),
    }, PEER, 1)
    expect(status).toBe(415)
    expect(headers).toMatchObject({ connection: 'close' })
    expect(destroyed).toEqual([true])
  })

  /** A response body that records its own cancellation, with one chunk queued. */
  function streamedResponseBody(): { body: ReadableStream<Uint8Array>; cancelled: () => boolean } {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1024))
        controller.enqueue(new Uint8Array(64 * 1024))
      },
      cancel() { cancelled = true },
    })
    return { body, cancelled: () => cancelled }
  }

  /** A response double whose socket buffer is full for every write. */
  function backpressuredResponse(request: IncomingMessage): { response: ServerResponse; ended: () => boolean } {
    let ended = false
    const response = Object.assign(responseRecorder(request), {
      destroyed: false,
      writableEnded: false,
      getHeader() { return undefined },
      writeHead() { return this },
      write() { return false },
      end(this: { writableEnded: boolean }) { ended = true; this.writableEnded = true; return this },
    })
    return { response, ended: () => ended }
  }

  /** Wait for the bridge to settle, so a parked loop fails instead of hanging the suite. */
  async function settledOrParked(pending: Promise<void>): Promise<string> {
    return await Promise.race([
      pending.then(() => 'settled'),
      new Promise<string>((resolve) => { setTimeout(() => { resolve('parked') }, 2_000) }),
    ])
  }

  it('stops reading a body whose client vanished while the loop waited for drain', async () => {
    const request = Readable.from([]) as IncomingMessage
    Object.assign(request, {
      url: '/api/session.export',
      method: 'GET',
      headers: { accept: 'application/octet-stream' },
    })
    const streamed = streamedResponseBody()
    const backpressured = backpressuredResponse(request)

    const pending = bridge(request, backpressured.response, {
      requestBodyMode: () => 'buffered',
      fetch: async () => new Response(streamed.body, { status: 200 }),
    }, PEER)
    // The disconnect a real socket reports mid-wait: one 'close', then a write
    // that reports backpressure nothing will ever drain.
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    Object.assign(backpressured.response, { destroyed: true })
    backpressured.response.emit('close')

    expect(await settledOrParked(pending)).toBe('settled')
    expect(streamed.cancelled()).toBe(true)
    expect(backpressured.ended()).toBe(false)
  })

  it('stops reading a body whose client was already gone before the first write', async () => {
    const request = Readable.from([]) as IncomingMessage
    Object.assign(request, {
      url: '/api/session.export',
      method: 'GET',
      headers: { accept: 'application/octet-stream' },
    })
    const streamed = streamedResponseBody()
    const backpressured = backpressuredResponse(request)
    // 'close' already fired: the loop must read the response state instead of
    // subscribing to an event that will never arrive again.
    Object.assign(backpressured.response, { destroyed: true })

    const pending = bridge(request, backpressured.response, {
      requestBodyMode: () => 'buffered',
      fetch: async () => new Response(streamed.body, { status: 200 }),
    }, PEER)

    expect(await settledOrParked(pending)).toBe('settled')
    expect(streamed.cancelled()).toBe(true)
    expect(backpressured.ended()).toBe(false)
  })
})
