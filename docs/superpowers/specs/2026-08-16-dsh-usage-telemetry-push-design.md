# DSH Usage Telemetry Settings Toggle and Push Exporter — Design

English | [中文](2026-08-16-dsh-usage-telemetry-push-design.zh.md)

Date: 2026-08-16
Status: draft, pending review

## 1. Context

`@deepseek-ai/dsh-usage-telemetry` already captures every session-attributed
live `llm/stream` call as a frozen v1 JSONL row under
`$DSH_HOME/telemetry/usage-YYYY-MM-DD.jsonl`. DeepSeek Monitor currently reads
that file by polling it (the `localLog` channel).

Two product gaps remain:

1. **A — no Web toggle.** The `usage-telemetry` settings namespace exists and
   hot-applies, but it is absent from `WEB_SETTINGS_NAMESPACES`, so the Web
   settings surface cannot turn local recording on or off.
2. **B — no push path.** Multi-machine, remote, and realtime dashboards cannot
   read another machine's local file. A disabled-by-default exporter plugin is
   needed so each DSH instance can push its local rows to one ingestion
   endpoint.

The corresponding DeepSeek Monitor handoff contract defines
`POST /api/v1/dsh/usage` with batch idempotency.

## 2. Goals and non-goals

Goals:

- Keep local JSONL capture as the durable source of truth.
- Add a Web settings toggle for local capture (A).
- Add a disabled-by-default `usage-exporter` plugin that tails the local JSONL
  and pushes batches over HTTP (B).
- Keep the exporter decoupled from the capture core and from any specific
  dashboard; TokenMonitor is only the first endpoint implementation.

Non-goals:

- Changing the frozen v1 row format.
- Replacing local file capture with push-only capture.
- Generic multi-tenant dashboard backend.
- TokenMonitor pushing configuration back into DSH.

## 3. Part A — Web toggle for local capture

### Host changes

- `packages/host/apiproxy/src/api-proxy.ts`: add
  `USAGE_TELEMETRY_SETTINGS_NAMESPACE` to `WEB_SETTINGS_NAMESPACES`.
  The namespace registration and hot-apply logic in `dsh-usage-telemetry`
  already exist and stay unchanged.
- Add an api-proxy test pinning that `settings.describe` exposes
  `usage-telemetry` and that a settings write through the proxy reaches the
  service.

### Client changes

- `packages/client/ui-settings-plugins`: add a `UsageTelemetryCard`
  contribution to the existing `settings.plugin.item` slot, following the
  Bash/AgentLoop/WebSearch card pattern.
- The card binds `ctx.settingsScope.bind({ namespace: 'usage-telemetry' })`,
  renders one switch for `enabled`, and writes only the `enabled` leaf via
  `setPath`.
- Copy is bilingual: English and Chinese; the card states that external tools
  such as DeepSeek Monitor read the local telemetry file.

### Tests

- Plugin registration test for the new card.
- Component test for read/write/toggle behavior.
- Update the Plugins settings aria golden (one new card).

## 4. Part B — push exporter plugin

### Package

New host package `@deepseek-ai/dsh-usage-exporter` under
`packages/telemetry/usage-exporter`.

The package owns one plugin with no default export surface beyond its Cordis
module contract, following other feature packages. It is mounted in the
shipped Web bundle as a **disabled** entry:

```yaml
- id: usage-exporter
  name: '@deepseek-ai/dsh-usage-exporter'
  disabled: true
```

Deployments opt in by removing `disabled: true` and supplying an endpoint.

### Why tail the JSONL rather than consume an event?

The exporter intentionally does **not** subscribe to a new in-memory event
from `usage-telemetry`:

- The local JSONL is already the durable, ordered source of truth;
- offset cursors give restart-safe progress and a natural backfill boundary;
- the exporter can be enabled, disabled, upgraded, or hot-reloaded without
  touching capture;
- the same parser validation can be reused from `dsh-usage-telemetry`.

This keeps Part B a pure additive plugin and leaves capture unchanged.

### Config

Schemastery `Config`:

| Field | Type | Default | Notes |
|---|---|---|---|
| `endpoint` | string | — | Absolute `https?://` URL, required |
| `token` | string | `''` | `role('secret')`; sent as `Authorization: Bearer <token>` |
| `sourceId` | string | auto | `[A-Za-z0-9._-]{1,64}`; default derived from hostname + DSH home hash |
| `pollIntervalMs` | number | 1000 | Tail poll interval |
| `maxBatchRows` | number | 200 | 1–1000 |
| `maxBatchBytes` | number | 262144 | Upper body bound; server contract also caps at 1 MiB |
| `requestTimeoutMs` | number | 10000 | Per HTTP attempt |
| `maxAttempts` | number | 5 | Retries for transient failures |
| `baseRetryMs` | number | 1000 | Exponential backoff base |
| `maxRetryMs` | number | 30000 | Backoff ceiling |
| `startFrom` | `'end' \| 'beginning'` | `'end'` | First enable tails the current EOF; `beginning` is explicit backfill |

### Data flow

```text
usage-telemetry ──append──> usage-*.jsonl
                                 │
usage-exporter ──poll+tail───────┘
  │ parse and validate each line (v1 row schema)
  │ accumulate rows into a batch
  │ build batchId = sha256(sourceId, file identity, [startOffset, endOffset))
  ▼
POST {endpoint}
  Authorization: Bearer <token>
  { sourceId, batchId, sentAt, rows }
  │
  ├─ 2xx / duplicate-batch ──> persist cursor past the batch
  ├─ 429/5xx/network ─────────> retry same batchId with backoff
  └─ 400/401/413 permanent ───> log, advance cursor (local file remains source of truth)
```

### Cursor persistence

- Cursor file: `$DSH_HOME/storages/usage-exporter.json`.
- One entry per endpoint/source pair: `{ file, offset, mtimeMs }` for each
  telemetry file currently being tailed.
- A cursor advances only after the server acknowledges the batch (or the
  request is classified as permanently rejected).
- Writes are atomic (`write temp file` + `rename`), matching the repository's
  small-durable-state conventions.
- Old cursor entries for deleted telemetry files are pruned on startup.

### Batch identity and retry

- `batchId` is deterministic over `(sourceId, file identity, startOffset,
  endOffset)` so retries reuse the same id.
- Retries never re-partition rows: the same byte range always forms the same
  batch.
- On restart the exporter resumes at the last acknowledged cursor; rows never
  acknowledged are retried after the next poll.
- Monitor-side idempotency is by `(sourceId, batchId)`, not row fingerprint,
  so byte-identical legitimate rows in different batches are never collapsed.

### Error handling

| Failure | Exporter behavior |
|---|---|
| Local malformed line | Log once, skip that line, advance offset |
| 401 | Log `usage-exporter: ingestion unauthorized`, back off to `maxRetryMs`, keep cursor |
| 400/413 | Log permanent rejection, advance cursor so one poison batch cannot strand the queue |
| 429/5xx/network | Retry up to `maxAttempts` with exponential backoff, then keep the cursor and wait for the next poll cycle |
| Server duplicate batch response | Treat as success and advance cursor |
| Disposal | Stop polling, await the in-flight request, persist the latest acknowledged cursor |

### Security and privacy

- The token is `role('secret')` and never logged.
- `endpoint` must be `https` unless it is loopback (`http://127.0.0.1`,
  `http://localhost`), which keeps the default TokenMonitor setup convenient.
- Rows may contain `cwd`; the endpoint is therefore treated as a trusted sink.
  A future option may redact `cwd` for remote endpoints.
- No new row fields are sent beyond frozen v1 data plus envelope metadata.

## 5. Interaction with TokenMonitor

The Monitor handoff contract (`2026-08-16-dsh-usage-ingest-handoff.md`,
delivered in the TokenMonitor repository) defines:

- `POST /api/v1/dsh/usage` with `sourceId`, `batchId`, `sentAt`, and v1 rows;
- batch idempotency keyed by `(sourceId, batchId)` with a TTL;
- the same row-to-`UsageRecord` mapping as the current file scanner;
- suppression of periodic `localLog` polling for a telemetry root once its
  source is pushing, while retaining manual backfill.

The exporter's `startFrom: 'end'` default leaves pre-enable history to the
existing file scanner, so push and file scan do not double-count.

## 6. Testing

- `dsh-usage-telemetry`: namespace exposure tests live in apiproxy tests.
- `dsh-usage-exporter` unit tests:
  - config schema/defaults and endpoint/token validation;
  - JSONL tailing, cursor advance, and restart resume;
  - batch construction and deterministic `batchId`;
  - retry/backoff classification for each HTTP outcome;
  - malformed-line skipping and permanent-rejection advancement;
  - cursor store atomic write/prune behavior;
  - graceful disposal waits for the in-flight request.
- Loader composition test:
  - default shipped Web composition keeps the entry disabled;
  - an overlay enabling it against a local HTTP fixture receives one batch and
    does not lose rows on restart.
- Web e2e:
  - the new Usage Telemetry card renders and writes `enabled: false` through to
    `$DSH_HOME/settings.yaml`.

## 7. Rollout

1. Implement A and ship the Web toggle enabled.
2. Implement B as a disabled entry in the Web bundle.
3. Merge the TokenMonitor ingest endpoint in the Monitor repository.
4. After both sides land, opt in locally by enabling the exporter row and
   configuring `endpoint`/`token`; existing file scanning remains available
   for backfill and for DSH instances without the exporter.

## 8. Open decisions

- Exact default `sourceId` derivation (hostname + short DSH-home hash is the
  current proposal).
- Whether `cwd` should be sent to non-loopback endpoints by default (current
  proposal: send it; remote deployments should prefer HTTPS and trusted sinks).
