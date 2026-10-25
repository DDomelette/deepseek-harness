/** Native fetch cancellation under explicit GC, isolated from the Vitest worker. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { installFetchObserver, type FetchObserver } from '../../src/host/inspection/network.ts'
import { isPlainObject } from '../../src/shared/json.ts'
import type { InspectorRecordInput } from '../../src/shared/bridge/messages/observation.ts'

const limit = Number(process.argv[2])
assert(limit === 4 || limit === 1_024)
const stopped = process.argv[3] === 'true'
assert(process.argv[3] === 'true' || process.argv[3] === 'false')
const gc = globalThis.gc
assert(gc, 'The fixture requires --expose-gc')
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.write('data: first\n\n')
})
await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
let observer: FetchObserver | undefined
try {
  const records: InspectorRecordInput[] = []
  let resolveEnd!: () => void
  const ended = new Promise<void>((resolve) => { resolveEnd = resolve })
  observer = installFetchObserver({
    publish(topic, payload, monotonicMs = performance.now()) {
      records.push({ topic, payload, monotonicMs })
      if (topic === 'fetch/end') resolveEnd()
    },
  }, { maxRequestBodyBytes: 1_024, maxResponseBodyBytes: limit, maxChunkBytes: 1_024 })
  const abort = new AbortController()
  const { port } = server.address() as AddressInfo
  const response = await fetch('http://127.0.0.1:' + String(port) + '/open-stream', { signal: abort.signal })
  const reader = response.body!.getReader()
  await reader.read()
  if (limit === 4) await ended
  if (stopped) await observer.stop()
  for (let pass = 0; pass < 5; pass++) {
    gc()
    await new Promise<void>((resolve) => { setImmediate(resolve) })
  }
  abort.abort()
  await assert.rejects(boundedRead(reader.read()), { name: 'AbortError' })
  await ended
  const end = records.find(record => record.topic === 'fetch/end')?.payload
  assert(isPlainObject(end))
  assert.equal(end.responseBodyTruncated, !stopped)
  if (limit === 4) assert.equal(end.responseCaptureError, undefined)
  else if (stopped) assert.equal(end.responseCaptureError, 'inspector stopped during body capture')
  else {
    assert(typeof end.responseCaptureError === 'string')
    assert.match(end.responseCaptureError, /AbortError/u)
  }
  console.log(JSON.stringify({ aborted: true, captureTruncated: limit === 4, observerStopped: stopped }))
} finally {
  server.closeAllConnections()
  try { await observer?.stop() }
  finally { await new Promise<void>((resolve) => { server.close(() => { resolve() }) }) }
}

/** Bound cancellation after a completed response read; the outer process budget includes startup and GC. */
async function boundedRead<T>(read: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([read, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new Error('Caller abort did not reach the response stream')) }, 2_000)
    })])
  } finally { clearTimeout(timer) }
}
