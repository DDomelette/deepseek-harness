/**
 * The cache policy of the shipped service worker, loaded from the real
 * `apps/web/public/sw.js` source: static-asset GETs the document loads answer
 * stale-while-revalidate, while `/api` requests, navigations, non-GET
 * requests, fetch/EventSource traffic, and the worker's own script reach the
 * network with no interception.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const SW_SOURCE = fileURLToPath(new URL('../public/sw.js', import.meta.url))
const CACHE_NAME = 'dsh-static-v1'
const ORIGIN = 'http://127.0.0.1:3080'

/** The request fields the worker's fetch handler reads. */
interface WorkerRequest {
  readonly url: string
  readonly method: string
  readonly destination: string
}

/** One stored value standing in for a `Response`. */
interface CachedResponse {
  readonly ok: boolean
  readonly body: string
  readonly clone: () => CachedResponse
}

/**
 * The event surface the worker's handlers touch. Each handler reads only the
 * members its own event type carries: `fetch` uses `request` and
 * `respondWith`, `activate` uses `waitUntil`, and `install` uses none.
 */
interface WorkerEvent {
  readonly request?: WorkerRequest
  readonly respondWith?: (response: Promise<CachedResponse | undefined>) => void
  readonly waitUntil?: (work: Promise<unknown>) => void
}

/** The `caches.open()` return value the worker uses. */
interface WorkerCache {
  match: (request: WorkerRequest) => Promise<CachedResponse | undefined>
  put: (request: WorkerRequest, response: CachedResponse) => Promise<void>
}

/**
 * Evaluate the real worker source against a minimal service-worker global.
 * @returns the registered handlers, the fake cache storage, and the fakes the
 * worker drove.
 */
async function loadServiceWorker() {
  const entries = new Map<string, CachedResponse>()
  const handlers = new Map<string, (event: WorkerEvent) => void>()
  const match = vi.fn(async (request: WorkerRequest): Promise<CachedResponse | undefined> => entries.get(request.url))
  const put = vi.fn(async (request: WorkerRequest, response: CachedResponse): Promise<void> => {
    entries.set(request.url, response)
  })
  const cache: WorkerCache = { match, put }
  const open = vi.fn(async (_name: string): Promise<WorkerCache> => cache)
  const skipWaiting = vi.fn((): void => {})
  const claim = vi.fn(async (): Promise<void> => {})
  const network = vi.fn(async (_request: WorkerRequest): Promise<CachedResponse> => cached('network'))

  runInNewContext(await readFile(SW_SOURCE, 'utf8'), {
    self: {
      addEventListener: (type: string, handler: (event: WorkerEvent) => void): void => { handlers.set(type, handler) },
      skipWaiting,
      clients: { claim },
      caches: { open },
    },
    fetch: network,
    URL,
    Set,
  })

  return { entries, handlers, match, put, open, skipWaiting, claim, network }
}

type LoadedWorker = Awaited<ReturnType<typeof loadServiceWorker>>

/** One response value the fakes can store and answer with. */
function cached(body: string, ok = true): CachedResponse {
  const response: CachedResponse = { ok, body, clone: () => response }
  return response
}

/**
 * Read one handler the worker registered, failing loudly when the source stops
 * registering it.
 * @param worker - the loaded worker.
 * @param type - the event type.
 * @returns the registered handler.
 */
function handlerOf(worker: LoadedWorker, type: string): (event: WorkerEvent) => void {
  const handler = worker.handlers.get(type)
  if (handler === undefined) throw new Error(`sw.js registered no ${type} handler`)
  return handler
}

/**
 * Dispatch one fetch event and capture what the handler passed to `respondWith`.
 * @param worker - the loaded worker.
 * @param request - the request fields the event carries.
 * @returns the handler's `respondWith` call arguments.
 */
function dispatchFetch(worker: LoadedWorker, request: WorkerRequest): Promise<CachedResponse | undefined>[] {
  const respondWith = vi.fn((_response: Promise<CachedResponse | undefined>): void => {})
  handlerOf(worker, 'fetch')({ request, respondWith })
  return respondWith.mock.calls.map(call => call[0])
}

describe('service-worker cache policy', () => {
  it('answers an uncached static asset from the network and stores it', async () => {
    const worker = await loadServiceWorker()
    const asset = `${ORIGIN}/assets/index-abc123.js`
    const fromNetwork = cached('network')
    worker.network.mockResolvedValue(fromNetwork)

    const answered = dispatchFetch(worker, { url: asset, method: 'GET', destination: 'script' })

    expect(worker.open).toHaveBeenCalledWith(CACHE_NAME)
    await expect(answered[0]).resolves.toBe(fromNetwork)
    expect(worker.put).toHaveBeenCalledWith(expect.objectContaining({ url: asset }), fromNetwork)
  })

  it('answers a cached static asset while refreshing it from the network', async () => {
    const worker = await loadServiceWorker()
    const asset = `${ORIGIN}/assets/index-abc123.js`
    const stored = cached('stored')
    const refreshed = cached('refreshed')
    worker.entries.set(asset, stored)
    worker.network.mockResolvedValue(refreshed)

    const answered = dispatchFetch(worker, { url: asset, method: 'GET', destination: 'script' })

    await expect(answered[0]).resolves.toBe(stored)
    await worker.network.mock.results[0]!.value
    expect(worker.put).toHaveBeenCalledWith(expect.objectContaining({ url: asset }), refreshed)
  })

  it('leaves a failed network response out of the cache', async () => {
    const worker = await loadServiceWorker()
    const missing = cached('not found', false)
    worker.network.mockResolvedValue(missing)

    const answered = dispatchFetch(worker, { url: `${ORIGIN}/assets/gone.css`, method: 'GET', destination: 'style' })

    await expect(answered[0]).resolves.toBe(missing)
    expect(worker.put).not.toHaveBeenCalled()
  })

  it('passes /api requests through untouched', async () => {
    const worker = await loadServiceWorker()

    expect(dispatchFetch(worker, {
      url: `${ORIGIN}/api/attachment.png`,
      method: 'GET',
      destination: 'image',
    })).toEqual([])
    expect(worker.open).not.toHaveBeenCalled()
    expect(worker.network).not.toHaveBeenCalled()
  })

  it('passes navigations through untouched', async () => {
    const worker = await loadServiceWorker()

    expect(dispatchFetch(worker, { url: `${ORIGIN}/`, method: 'GET', destination: 'document' })).toEqual([])
    expect(worker.open).not.toHaveBeenCalled()
    expect(worker.network).not.toHaveBeenCalled()
  })

  it('passes non-GET requests through untouched', async () => {
    const worker = await loadServiceWorker()

    expect(dispatchFetch(worker, {
      url: `${ORIGIN}/assets/index-abc123.js`,
      method: 'POST',
      destination: 'script',
    })).toEqual([])
    expect(worker.open).not.toHaveBeenCalled()
    expect(worker.network).not.toHaveBeenCalled()
  })

  it('passes fetch, XHR, and event-stream requests through untouched', async () => {
    const worker = await loadServiceWorker()

    // The dev SSE channel never completes, so a mediated fetch would hold a
    // connection open and stall later requests on the same origin.
    expect(dispatchFetch(worker, {
      url: `${ORIGIN}/plugins/events`,
      method: 'GET',
      destination: '',
    })).toEqual([])
    expect(worker.open).not.toHaveBeenCalled()
    expect(worker.network).not.toHaveBeenCalled()
  })

  it('passes the worker script itself through untouched', async () => {
    const worker = await loadServiceWorker()

    expect(dispatchFetch(worker, { url: `${ORIGIN}/sw.js`, method: 'GET', destination: 'serviceworker' })).toEqual([])
    expect(worker.open).not.toHaveBeenCalled()
    expect(worker.network).not.toHaveBeenCalled()
  })

  it('takes over immediately: skipWaiting on install and clients.claim on activate', async () => {
    const worker = await loadServiceWorker()
    const claimed = Promise.resolve()
    worker.claim.mockReturnValue(claimed)
    const waitUntil = vi.fn((_work: Promise<unknown>): void => {})

    handlerOf(worker, 'install')({})
    expect(worker.skipWaiting).toHaveBeenCalledOnce()

    handlerOf(worker, 'activate')({ waitUntil })
    expect(worker.claim).toHaveBeenCalledOnce()
    expect(waitUntil).toHaveBeenCalledWith(claimed)
  })
})
