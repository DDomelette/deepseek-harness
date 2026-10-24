# Agent Note: Menu placement settles and re-arms

Status: implemented

English | [中文](2026-10-19-menu-placement-settles-and-rearms.zh.md)

## Problem

An open portal `Menu` ran a `requestAnimationFrame` placement loop for the list's whole lifetime, and every frame read the anchor's `getBoundingClientRect()` plus the list's `offsetWidth` and `offsetHeight`. An idle open menu therefore forced a style-and-layout pass on every frame until it closed. The loop existed because an ancestor can move the anchor with no scroll and no resize — a drag, a transform transition, a keyframe — and that movement is real; measuring every frame of an idle menu to catch it is not.

## Decision

`packages/client/ui-primitives/src/Menu.tsx` places once before paint when the list opens, then measures in a frame loop that stops after `SETTLE_FRAMES = 2` consecutive measurements reporting no change. One measurement covers the anchor edges (`left`, `top`, `right`, `bottom`) and the list size (`offsetWidth`, `offsetHeight`); any difference from the previous measurement resets the counter, so the loop keeps running while the anchor or the list is still moving.

Six signals re-arm it: `scroll` in the capture phase, so a nested pane's scroll counts; `resize`; `pointermove` while a pointer button is held; `transitionrun`; `animationstart`; and a re-render of the list. The scroll and resize listeners place at once and then track the frames that follow the movement, and so does the opening measurement, because the list can still settle its own size in the first frames after it mounts. The pointer, transition, and animation listeners start the loop for its next frame. A re-render places once more before paint through the placement ref, since a stopped loop would otherwise leave the new size unclamped.

The invariant relied on: every movement of the anchor is announced by one of those signals before it paints. A drag announces itself on the first `pointermove` carrying a held button, a transform or transition or keyframe through `transitionrun` or `animationstart`, a scroll and a viewport change through `scroll` and `resize`, and a change to the list's own content through the re-render that produces it. A loop that has stopped is therefore armed again during the frames of the movement, not after them.

Placement keeps the last submitted viewport coordinates in an instance ref and calls React's state setter only when those coordinates change. Returning the previous value from a functional updater still submits an update from the post-commit placement effect; during a floating-panel drag those submissions can repeat until React rejects the nested updates and the slot retires the menu's owner. Closing or disabling portal placement clears both the coordinates and the rendered position. The frame loop still measures movement and list size independently of whether placement needs a render.

## Alternatives considered

- **Watch the anchor with a `ResizeObserver`.** Rejected: it reports box-size changes rather than position changes, so drags and transforms would still need the frame loop; and it breaks a spec. `packages/client/ui-sidebar-documentpreview/tests/zoom-viewport.client.spec.tsx` stubs `ResizeObserver` with one captured callback slot, so a second observer constructed by `Menu` overwrites the callback that preview drives.
- **Keep measuring every frame and make one measurement cheaper.** Rejected: the anchor rect and the two `offset*` reads are the layout the loop exists to read, and caching them across frames fails exactly when an ancestor moves the anchor.

## Consequences

- An idle open menu measures once per signal instead of once per frame, so the cost follows movement instead of the list's lifetime.
- Accepted trade-off: a size change produced by neither a re-render nor an event — reflow inside the list that no prop change caused — waits for the next signal before the position is clamped. Movement itself is unaffected, because the invariant above is what places it.
- `atoms.client.spec.tsx` pins the three paths: frames after the settled measurement stop calling `getAnchorRect`, a `scroll` places immediately and restarts tracking, and a re-render re-places a stopped menu.
