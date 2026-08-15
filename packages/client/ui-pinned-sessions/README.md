# @deepseek-ai/dsh-client-ui-pinned-sessions

English | [中文](README.zh.md)

Pinned-sessions browser plugin for the DeepSeek Harness sidebar. It registers the pinned section, per-row pin action, and search-result pin badge into the three slots declared by `@deepseek-ai/dsh-client-ui-workspace`.

## Slot registrations

- `sidebar.workspaces.pinned` — the pinned list above the project tree. Grouped view groups by owning workspace; flat view renders one list. The section hides when no session is pinned.
- `sidebar.workspaces.sessionActions` — the hover-revealed pin/unpin button rendered left of the row ellipsis.
- `sidebar.workspaces.searchResultExtra` — the blue pin badge on pinned search results.

## Store contract

The plugin owns a root-scoped `defineStore` handle: `snapshot`, `ready`, and `error`. Actions are `commit`, `optimistic`, `rollback`, and `fail`. Remote results replace the snapshot after durability; failed mutations roll back the previous snapshot.

## Remote methods used

`remote.sessionPins.list`, `setPinned`, `reorderGroup`, and `reorderFlat`. The plugin re-pulls `list` on `connection/reset`.

## Locale namespace

`sessionPins` (zh/en): pinned, pin, unpin, pinnedBadge, projects, ungrouped.

## Model Experience

No direct effect: the plugin renders sidebar chrome only and registers no tools, prompts, or session events.

### Token effect

Zero direct tokens.

### KV Cache effect

Independent of live requests.

## Known Limitations and Deferred Work

- **Pinned rows render only the unpin action** — rename/fork/archive remain available through the session's project row in v1.
- **No keyboard drag ordering** — pinned reordering is pointer-drag only.
