---
description: "Configuration and behavior of ui-pinned-sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-pinned-sessions

English | [中文](README.zh.md)

## Summary

Pinned-sessions browser plugin for the DeepSeek Harness sidebar. It registers the pinned section, per-row pin action, and search-result pin badge into the three slots declared by `@deepseek-ai/dsh-client-ui-workspace`.


## Table of Contents

- [Slot registrations](#slot-registrations)
- [Store contract](#store-contract)
- [Remote methods used](#remote-methods-used)
- [Locale namespace](#locale-namespace)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="slot-registrations"></a>
## Slot registrations

- `sidebar.workspaces.pinned` — the pinned list above the project tree. Grouped view groups by owning workspace; flat view renders one list. The section hides when no session is pinned. Session selection is highlighted only while no main panel is active.
- `sidebar.workspaces.sessionActions` — the hover-revealed pin/unpin button rendered left of the row ellipsis.
- `sidebar.workspaces.searchResultExtra` — the blue pin badge on pinned search results.

Non-blank pinned rows expose Rename, Fork, and Archive alongside Unpin. Pinned and project rows share the UI primitives' accessible status marker and relative-time bucketing; each plugin owns its row layout, menu actions, and drag interactions.

Dragging inserts the source before or after another row in the same group; cross-group drops are ignored. Grouped and flat order overrides persist independently and survive reload.

<a id="store-contract"></a>
## Store contract

The plugin owns a root-scoped `defineStore` handle: `snapshot`, `ready`, and `error`. Actions are `commit`, `optimistic`, `rollback`, and `fail`. Remote results replace the snapshot after durability; failed mutations roll back the previous snapshot. A failed refresh records `error` while retaining the last snapshot; the next successful refresh clears it.

<a id="remote-methods-used"></a>
## Remote methods used

`remote.sessionPins.list`, `setPinned`, `reorderGroup`, and `reorderFlat`. The plugin re-pulls `list` on `connection/reset`.

<a id="locale-namespace"></a>
## Locale namespace

`sessionPins` (zh/en): pinned, pin, unpin, pinnedBadge, projects, ungrouped.

<a id="model-experience"></a>
## Model Experience

### Request context and condition

#### What the model sees

No model-facing surface from this package. The plugin renders `sidebar.workspaces` chrome only and registers no tools, prompts, or session events.

#### Token effect

Zero direct tokens.

#### KV Cache effect

Independent of live requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No keyboard drag ordering** — pinned reordering is pointer-drag only.

<a id="dev-note"></a>
### Dev Note

None.

No runtime invariant companion is published. The package validates inputs at registration or writes and exposes no second authoritative state to compare against an independent event stream.
