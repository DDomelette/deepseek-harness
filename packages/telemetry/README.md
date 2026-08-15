# telemetry/ — local usage observation

English | [中文](README.zh.md)

Local, provider-reported usage observation that remains outside the durable session log and model-request assembly.

## Packages

| Package | Role | ctx key |
|---|---|---|
| [`usage-telemetry/`](usage-telemetry/README.md) | Captures one v1 JSONL row for each session-attributed `llm/stream` invocation that reports provider usage. | — |

`usage-telemetry` is an independent local monitor, not a `SessionTelemetryBackend`: the session telemetry backend delivers session activity, while this group records provider usage for external consumption monitoring. The [replay token meter](../../.agents/notes/implemented/architecture/2026-07-15-replay-token-meter-service.md) separately folds durable session events for request-pressure estimation and neither reads nor receives the local JSONL rows.
