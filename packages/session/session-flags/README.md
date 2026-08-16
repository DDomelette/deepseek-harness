# @deepseek-ai/dsh-session-flags

English | [中文](README.zh.md)

Generic per-session presentation flags for the DeepSeek Harness. Providers register flag maps for sessions they own; consumers read one merged projection through `ctx.sessionFlags`. The registry carries no business meaning of its own.

## Service API

- `registerProvider(provider)` — registers one `SessionFlagProvider` (`id` plus a synchronous `list()`); returns a disposer that removes it. Duplicate ids throw.
- `snapshot()` — merges providers in registration order. Later providers win per session and flag key. Returns `{ flags, complete }`; `complete` is `false` after any provider failure.

## Failure semantics

- A failing provider is logged and skipped; successful providers still contribute.
- When every provider fails and a previous complete snapshot exists, the previous complete snapshot is returned.
- A complete snapshot becomes the last-good snapshot.

## Model Experience

### Request context and condition

#### What the model sees

No model-facing surface from this package. Consumers such as the `sidebar.workspaces` browser surface the flags through their own documented paths.

#### Token effect

Zero direct tokens.

#### KV Cache effect

Independent of live requests; this package never touches request prefixes.

## Known Limitations and Deferred Work

- **No provider change notification** — consumers pull `snapshot()` at their own boundary; providers that change independently must publish their own event.
- **No per-flag conflict policy** — merge order is registration order; a future requirement for typed conflict handling needs an explicit policy.
