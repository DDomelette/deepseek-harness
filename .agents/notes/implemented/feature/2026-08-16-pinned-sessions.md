# Agent Note: pinned sidebar sessions

Status: implemented

English | [中文](2026-08-16-pinned-sessions.zh.md)

## Problem

The sidebar workspace browser had no way to keep important conversations visible above the project tree. Users had to find those sessions by project membership and recency, and a frequently visited session could be pushed down by newer activity.

## Decision

`@deepseek-ai/dsh-session-flags` provides a generic host-side presentation-flag registry (`ctx.sessionFlags`). Providers register synchronous flag maps; `workspace.list` carries the merged `sessionFlags` projection so the client workspace store remains presentation-only.

`@deepseek-ai/dsh-session-pins` owns the pinned-sessions capability. It persists a `session_pins` storage-domain global with `pinnedSessionIds`, per-workspace `groupOrder` overrides, and a flat `flatOrder` override, and exposes `remote.sessionPins` with `list`, `setPinned`, `reorderGroup`, and `reorderFlat`. Every mutation writes the domain first and returns the complete snapshot. A reorder that names an unknown, unpinned, or duplicate id fails with `session-pins-invalid` before writing. The same plugin registers the only flag provider, projecting `pinned: true`.

`@deepseek-ai/dsh-client-ui-pinned-sessions` registers the user-visible surface into three slots declared by `@deepseek-ai/dsh-client-ui-workspace`:

- `sidebar.workspaces.pinned` renders the pinned section inside the shared project scroll list. Grouped view groups by owning workspace; flat view renders one list; the section hides when no session is pinned.
- `sidebar.workspaces.sessionActions` renders the hover-only pin button left of the row ellipsis.
- `sidebar.workspaces.searchResultExtra` renders the pinned badge on search results.

`ui-workspace` filters `pinned: true` sessions from grouped and flat trees, keeps all-pinned project group headers with the new-session affordance, and ranks pinned search matches first. Pinned order defaults to the project account order (grouped) or recency (flat) and can be overridden by drag; the project account order is never rewritten, so unpinning restores the original position.

## Alternatives considered

- **Settings namespace persistence** — a `pinnedSessions` settings namespace would reuse the settings wire and file, but the settings revision/conflict machinery is built for configuration, not for high-frequency bookmark mutations, and it would leave the session list without a host-authoritative projection.
- **Direct ui-workspace implementation** — fastest to build, but it would couple presentation state and domain persistence into one package and make the capability impossible to disable independently.
- **Client-only localStorage** — simplest, but pins would not survive across browsers, profiles, or storage clears and would make the host projection stale by construction.

## Consequences

- Core gained one generic flag seam and three workspace slots; the pinned capability remains independently mountable.
- Search results and project trees now read the flag projection; a failed provider keeps the last good complete snapshot or degrades to an empty projection.
- Cross-process live pin sync is deferred: clients converge through `list()` after reconnect or restart.
- Pinned rows render the unpin action only; rename/fork/archive remain on the session's project row.

## Testing

Host domain and Remote behavior are pinned by `packages/session/session-pins/tests/session-pins.spec.ts`; flag merging by `packages/session/session-flags/tests/session-flags.spec.ts`; workspace flag delivery by `packages/host/apiproxy/tests/api-proxy-workspace.spec.ts`; tree filtering, empty groups, and search ranking by `packages/client/ui-workspace/tests/tree.client.spec.ts`; client registration and store rollback by `packages/client/ui-pinned-sessions/tests`.
