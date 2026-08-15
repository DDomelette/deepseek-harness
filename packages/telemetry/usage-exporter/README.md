# @deepseek-ai/dsh-usage-exporter

English | [中文](README.zh.md)

Optional Host plugin that tails the local usage telemetry JSONL written by [`@deepseek-ai/dsh-usage-telemetry`](../usage-telemetry/README.md) and pushes deterministic batches to DeepSeek Monitor's ingestion endpoint. The shipped Web composition mounts it **disabled**; local file capture stays the source of truth and Monitor's file scanner remains available for backfill.

## Usage

Enable the row in a profile patch and supply an endpoint:

```yaml
- id: usage-exporter
  name: '@deepseek-ai/dsh-usage-exporter'
  config:
    endpoint: http://127.0.0.1:29351/api/v1/dsh/usage
    token: '<ingest-token>'
    sourceId: my-laptop
```

The plugin tails `$DSH_HOME/telemetry/usage-YYYY-MM-DD.jsonl` with an offset cursor under `$DSH_HOME/storages/usage-exporter.json`. Batches have deterministic `batchId` values, retry with the same id, and advance the cursor only after an acknowledged, duplicate, permanently rejected, or abandoned outcome.

## Model Experience

### Usage push

#### What the model sees

No prompt, message, tool schema, tool result, or model-call change. The plugin tails existing `usage-*.jsonl` files and sends rows over `POST /api/v1/dsh/usage`.

#### Token effect

No direct token effect.

#### KV Cache effect

No direct effect; the plugin neither assembles nor sends provider requests.

## Known Limitations and Deferred Work

- **First enable starts at the current EOF** — history remains the Monitor file scanner's backfill path; `startFrom: 'beginning'` is an explicit override.
- **Single process per DSH home** — the cursor assumes one exporter owns each telemetry root, matching the capture writer's single-instance assumption.
- **Permanent 4xx rejection advances the cursor** — the rejected rows stay in the local JSONL for manual backfill, but push does not retry them forever.
- **No backpressure queue beyond retries** — rows emitted while the endpoint is down for longer than one retry window are abandoned from push and remain in the local file.
