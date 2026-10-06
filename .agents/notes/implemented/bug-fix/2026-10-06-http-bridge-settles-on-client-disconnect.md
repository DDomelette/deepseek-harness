# Agent Note: The response bridge settles when its client disconnects

Status: implemented

English | [中文](2026-10-06-http-bridge-settles-on-client-disconnect.zh.md)

## Problem

`bridge()` streams a handler's response body to a node:http response, and when a socket write reports backpressure it waits for `'drain'` or `'close'` before writing the next chunk. A client that cancels a long download mid-stream triggers `'close'` exactly once, and every later write on that destroyed response reports backpressure nothing will ever drain. Whenever that single `'close'` had already fired — during a wait, or before the loop's listeners existed — the wait subscribed to an event that could not arrive again: the loop parked, `bridge()` never settled, the `for await` never cancelled the body stream, and the webserver's own `await route.handler` never returned. Each cancelled streamed download (the Session-log export route streams a queued `ReadableStream`) stranded one response, one body stream, its queued buffers, and the handler's promise for the life of the process.

## Decision

Both loop exits read the response state instead of waiting for another event. The iteration stops before writing when `res.destroyed` is already true; the backpressure wait also resolves when it finds the response destroyed right after subscribing, because a `'close'` that landed first is one-shot and cannot be awaited again; and the loop breaks after that wait once the response is gone. `res.end()` is skipped for a destroyed response, and leaving the iteration cancels the body stream through the async iterator's return.

## Alternatives considered

- **Wait for `'drain'` or `'close'` with a timeout.** Rejected: a timer turns a correct exit into a latency penalty on every backpressured chunk, and the body stays uncancelled until it fires.
- **Rely on the abort signal the bridge already wires to the handler's request.** Rejected as the only mechanism: a producer that ignores its signal (the export route's queued stream) never ends, and the loop's own wait is what parks regardless of the producer.
- **Rewrite the loop with `stream.pipeline` and `Readable.fromWeb`.** Rejected for this fix: it replaces the response handling of every route to correct one exit condition, while the two state reads keep the existing chunk-by-chunk backpressure behavior.

## Consequences

- A cancelled streamed download now ends in the same millisecond: the recorded socket run destroys the response at 39 ms, cancels the body at 41 ms, and settles `bridge()` at 42 ms, where the same run before the change never settled and never cancelled anything.
- The read-to-completion path is unchanged: the same 12.8 MiB body still resolves with every byte delivered.
- A handler that ignores its abort signal now loses its body stream at cancellation instead of keeping it alive; producers must tolerate `cancel()`, which the `ReadableStream` contract already requires.

## Testing

- `packages/client/connection/tests/http-bridge.host.spec.ts` pins both orderings — a disconnect during the backpressure wait, and a response already destroyed before the first write — through a two-second `settledOrParked` deadline that reports `expected 'parked' to be 'settled'` without the fix, and asserts that the body's `cancel()` ran while `res.end()` was not called.
- A real node:http socket run against this source (client destroys its socket after the first 64 KiB chunk) records `client-destroy@39ms`, `res-close@40ms`, `body-cancelled@41ms`, `bridge-resolved@42ms`; the control run that reads the whole body still delivers all 13,109,176 bytes.
