# Agent Note: Attempt-scoped local usage telemetry

Status: implemented

English | [中文](2026-08-14-attempt-scoped-local-usage-telemetry.zh.md)

## Problem

DeepSeek Monitor needs a small local record of provider-reported token usage without receiving session content. A completed `assistant/message` is not the correct observation point: failed or aborted attempts can report billable usage without producing that event, retries collapse into the successful assistant message, and direct compaction or session-title calls bypass the agent loop's assistant-message path.

The on-disk v1 JSONL row is fixed and has no outcome, attempt, or purpose field. Recording only successful calls would give its fields a misleading completeness guarantee. The emitter also needs settings reload and teardown behavior that does not retain request state or leave file writes running after its Cordis fiber is disposed.

## Decision

`usage-telemetry` wraps the provider-neutral `llm/stream` waterfall. It passes every chunk through unchanged, remembers the last observed provider usage chunk, and enqueues one row in `finally` when the call has `GenerateOptions.sessionId`. A session-attributed call that emits usage records one row even when it later errors, is retried, or its consumer aborts or returns. Calls without usage or a session id produce no row.

The row records `time` when the usage chunk arrives, `model` from `GenerateOptions.model`, and optional `cwd` from the live session header. The package has no `session/event` listener, request-header path, or request-state cache, so a successful request has no second capture path.

The v1 row contains `v`, `time`, `sessionId`, optional `cwd`, optional `model`, and four input/output/cache token buckets. Missing cache buckets are zero. It does not infer outcome or purpose. The package README owns the consumer-facing row schema and local-file behavior.

The standard `usage-telemetry` settings section controls the listener. While the settings provider is attached, it overrides the composition value; after detachment, the source falls back to the composition entry. Stream finalization enqueues file writes without awaiting them. The writer orders appends issued by the service instance, continues after a rejected predecessor, and graceful disposal drains writes already started. Sharing one Harness home across processes is unsupported, a hard crash can lose unfinished writes, and calls that finish after teardown begins are omitted.

## Division from replay token measurement

The [replay token meter](../architecture/2026-07-15-replay-token-meter-service.md) folds durable session events to estimate the current model-visible request and reuses a successful-call usage anchor only when its request envelope still matches. Local usage telemetry records provider usage from each live, session-attributed model call for an external consumption monitor. It neither feeds nor replays the token meter, and the token meter does not read telemetry files. This separation preserves the meter's single-fold accounting and adds no double-counting relationship.

## Alternatives considered

**Continue observing `session/event`.** Rejected because durable assistant messages represent completed assembled responses, not every provider attempt or direct model call. Reconstructing attempts from that stream would still omit billable failed work and auxiliary calls.

**Write only after a successful terminal finish.** Rejected because provider usage is a consumption fact when its chunk arrives. Dropping it after an error, abort, or retry would systematically undercount while preserving no field that identifies the exclusion.

**Add outcome, attempt, and purpose to a v2 row.** Rejected because no current monitor requirement consumes those dimensions, and frozen v1 fields represent attempt-scoped usage without a consumer migration. A future v2 requires a consumer-coordinated decision.

**Derive external consumption from the replay token meter.** Rejected because the meter estimates current context pressure from durable session state and intentionally anchors only matching successful calls. It cannot recover failed attempts or direct calls that leave no corresponding durable assistant message.

## Verification

Unit coverage exercises successful, failed, retried, direct, missing-session, missing-usage, disabled, settings-detach, abort-after-usage, write-failure, serial-write, and disposal-drain behavior. A Loader composition test boots the LLM, session, and usage-telemetry plugins and observes JSONL output. A keyless replay snapshot runs a shipped profile with an isolated Harness home and pins the usage artifact without changing the model transcript.

## Consequences

Consumers receive one outcome-free usage fact per eligible provider attempt, not a completion record. Calls without a session id remain intentionally invisible. Local-date filenames can differ from Beijing aggregation days, so row `time` remains authoritative. The package avoids session-content export and durable-log changes, at the cost of no cross-process append guarantee and no crash-time write recovery.
