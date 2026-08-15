# Agent Note: Optional usage exporter over the local telemetry JSONL

Status: implemented

English | [中文](2026-08-16-usage-exporter.zh.md)

## Problem

`@deepseek-ai/dsh-usage-telemetry` records every session-attributed model call in a local JSONL. DeepSeek Monitor can read that file only when both processes share one filesystem. Remote and multi-machine dashboards need dsh to push rows instead.

## Decision

`@deepseek-ai/dsh-usage-exporter` is a disabled-by-default Host plugin. It does not subscribe to `llm/stream`; it tails `$DSH_HOME/telemetry/usage-*.jsonl` with an offset cursor, builds deterministic batches (`batchId = sha256(sourceId, file, startOffset, endOffset)`), and POSTs them to Monitor's `POST /api/v1/dsh/usage`. The Monitor contract additionally carries `rootId` (canonicalized telemetry-root hash) so auto collection-mode can suppress file polling for the same root, and a heartbeat envelope renews the push lease while idle.

A batch retries with the same `batchId` up to `maxAttempts`, then is abandoned and the cursor advances; the local file remains the backfill source. The cursor persists under `$DSH_HOME/storages/usage-exporter.json` and advances only after accepted, duplicate, permanent-rejection, or abandoned outcomes.

## Alternatives considered

**In-process event stream from usage-telemetry.** Rejected: the local JSONL is already the durable ordered source of truth, and a tail reader adds no coupling to the capture core.

**Push-only capture.** Rejected: losing the local file would remove replay and backfill, and would make the exporter load-bearing for every dsh instance.

## Consequences

- The shipped Web composition keeps the entry `disabled: true`; deployments opt in per profile.
- Push and file scan can coexist without double-counting via Monitor's `rootId` + collection-mode + lease rules.
- Endpoint/token config is secret-role and never logged; non-loopback endpoints require HTTPS.

## Testing

- `packages/telemetry/usage-exporter`: config schema/defaults, cursor store atomic persistence/prune, tail EOF snapshot/new-file/truncation/malformed-line behavior, sender classification (accepted, duplicate, 401 permanent, 5xx retryable, heartbeat), apply poll/push/cursor advance, and the disabled Web bundle row.
