# @deepseek-ai/dsh-usage-telemetry

English | [中文](README.zh.md)

Local, attempt-scoped provider-usage capture. The plugin observes live `llm/stream` calls and appends an outcome-free v1 JSONL row only when a call has both a `sessionId` and a provider usage chunk.

## Configuration and composition

`enabled` controls whether the service subscribes to `llm/stream`. The shipped Web composition enables the package; a deployment can replace that Cordis entry or set the standard `usage-telemetry` settings section. The generated [configuration catalog](../../../docs/config-catalog.md) lists the validated configuration.

```yaml
- id: usage-telemetry
  name: '@deepseek-ai/dsh-usage-telemetry'
  config:
    enabled: true
```

The settings provider overrides the composition value while it is attached. If it detaches, the service falls back to the composition value. An enabled-state change adds or removes only the `llm/stream` listener.

## v1 JSONL rows

One row records one session-attributed `llm/stream` invocation that emitted provider usage, including an invocation that later errors, is retried, or whose consumer aborts or returns. Calls without `sessionId` or provider usage produce no row. v1 has no outcome, status, attempt, or purpose field.

```json
{"v":1,"time":1786780800123,"sessionId":"sess_123","cwd":"D:\\Deepseek_Harness","model":"deepseek-chat","inputTokens":120,"outputTokens":48,"cacheReadTokens":32,"cacheWriteTokens":0}
```

| Field | Meaning |
|---|---|
| `v` | Frozen row-schema version: `1`. Unknown versions are not valid v1 input. |
| `time` | Unix milliseconds captured when the provider usage chunk arrives. This is the aggregation authority. |
| `sessionId` | Session that attributed the model call. |
| `cwd` | Optional current working directory from the live session header; omitted when unavailable. |
| `model` | Optional value from `GenerateOptions.model`. |
| `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens` | Provider-reported token buckets. Missing cache buckets are written as zero. |

## Data and lifecycle

Rows append to `$DSH_HOME/telemetry/usage-YYYY-MM-DD.jsonl`. The file name uses the host's local calendar date, so it can differ from DeepSeek Monitor's Beijing aggregation day; consumers use each row's `time`, not the filename, for aggregation.

Stream finalization serializes the row and enqueues its write without awaiting file I/O. The service instance serializes its appends, a rejected append does not block later rows, and write failures are logged without changing the model stream. Graceful service disposal drains writes already started. A hard process crash can lose unfinished writes.

Calls whose wrappers finalize after service teardown starts are not recorded.

## Replay token meter

The [replay token meter](../../../.agents/notes/implemented/architecture/2026-07-15-replay-token-meter-service.md) folds durable chunk and session events to estimate request pressure. It neither reads local usage JSONL nor receives telemetry rows, and usage telemetry neither reads nor changes the replay meter. The two mechanisms therefore introduce no double-counting relationship.

## Model Experience

### Local usage capture

#### What the model sees

No prompt, message, tool schema, tool result, or model call changes. The service observes an already-issued `llm/stream` call and writes only local JSONL.

#### Token effect

No direct token effect.

#### KV Cache effect

No direct effect; observing the stream does not change any request prefix.

## Known Limitations and Deferred Work

- **Capture is session-scoped** — calls without `sessionId` are intentionally absent, even when they report provider usage.
- **v1 is outcome-free** — the last usage chunk observed for an invocation is written even if that invocation later fails, is retried, or is aborted; rows do not identify outcome, attempt, or purpose.
- **`cwd` is best-effort** — it is omitted when the live session or its header value is unavailable.
- **File dates are local dates** — a filename can differ from the Beijing aggregation day; row `time` remains authoritative.
- **A shared `DSH_HOME` is single-process only** — multiple processes can interleave JSONL appends and are unsupported.
- **Graceful disposal differs from a crash** — disposal drains already-started writes, while a hard process crash can lose unfinished writes.
- **Late-finalizing wrappers are omitted** — calls that finalize after teardown begins are not recorded.
