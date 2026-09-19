---
description: "Configuration and behavior of session-pins."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-pins

English | [中文](README.zh.md)

## Summary

Pinned-sessions persistence and Remote API for the DeepSeek Harness. The plugin owns a `session_pins` storage domain and registers one `SessionFlagProvider` that projects `pinned: true` for every pinned session id. The sidebar feature consumes the flags through `workspace.list.sessionFlags` and mutates pins through the generated `remote.sessionPins`.


## Table of Contents

- [Service API](#service-api)
- [Durable shape](#durable-shape)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="service-api"></a>
## Service API

`ctx.sessionPins` exposes `list()`, `setPinned({ sessionId, pinned })`, `reorderGroup({ groupKey, orderedIds })`, and `reorderFlat({ orderedIds })`. Every mutation writes the domain global first and returns the complete `SessionPinsSnapshot` after durability.

<a id="durable-shape"></a>
## Durable shape

- `pinnedSessionIds` — the pin set.
- `groupOrder` — optional manual order overrides keyed by workspace id or `''` for ungrouped.
- `flatOrder` — optional manual order override for the flat view.

A reorder that names an id not currently pinned, duplicates an id, or (for flat) omits a pinned id rejects with `session-pins-invalid` before any write. Rejected requests preserve the pin set and both saved orders.

<a id="model-experience"></a>
## Model Experience

### Request context and condition

#### What the model sees

No model-facing surface from this package. The `sidebar.workspaces` surface and search ordering are documented by the client pinned-sessions plugin.

#### Token effect

Zero direct tokens.

#### KV Cache effect

Independent of live requests; this package never touches request prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Cross-process live sync is deferred** — clients converge through `list()` after reconnect or restart.
- **Stale order keys are cleaned lazily** — deleted workspaces leave entries until the next mutation.

<a id="dev-note"></a>
### Dev Note

None.

No runtime invariant companion is published. The package validates inputs at registration or writes and exposes no second authoritative state to compare against an independent event stream.
