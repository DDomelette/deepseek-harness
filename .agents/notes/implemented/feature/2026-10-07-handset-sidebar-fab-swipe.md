# Agent Note: Handset sidebar: floating brand button and edge swipe

Status: implemented

English | [中文](2026-10-07-handset-sidebar-fab-swipe.zh.md)

## Problem

[Mobile responsive layout, batch A](2026-09-13-mobile-responsive-batch-a.md) gave the frame a handset band: below the 768px `SIDEBAR_OVERLAY` breakpoint an expanded sidebar floats over the center as a drawer, but the solve kept the 56px rail as the drawer's only on-screen trigger. On a ~390px phone the rail costs 14% of the column for a control column whose remaining jobs (New Session, workspace and search icons, Settings) duplicate paths the drawer itself offers, and batch A rejected swipe gestures outright, leaving small tap targets as the only way in and out of navigation.

## Decision

Below `SIDEBAR_OVERLAY` the closed sidebar owns no grid track. `packages/client/ui-layout/src/client/AppFrame.tsx` drops the solve's rail width after `computeColumns` (columns.ts keeps its 0→rail semantics for the squeeze band and its own tests), so a handset center always renders at full frame width. `SidebarOwnerProps` gains `fab: boolean`; ui-sidebar's SidebarRoot answers `collapsed && fab` with one fixed 36px round brand button at the frame's top-left corner (top 18px, left 10px, `--dsw-alias-bg-base`, 0.5px `--dsw-alias-border-l2` border, scrim-level z-index 12) carrying the `sidebar.brand.mark` slot at 24px and the existing `toggle.open` tooltip. The button is the entire collapsed tree; the drawer itself — content, scrim, Escape, scrim tap — is unchanged, and opening it flips `collapsed`, which unmounts the button.

The frame adds a tracked edge swipe, implemented in AppFrame with the DragHandle pattern (refs + rAF + imperative styles, zero store writes at pointer cadence). A `pointerdown` on the frame arms a candidate — below the breakpoint only: within 40px of the frame's left edge while closed, anywhere while the drawer is open. Travel under 8px stays a tap, and vertical-dominant travel cedes to nested scrollers. Engagement captures the pointer, marks the frame `data-sidebar-gesture` (which suppresses track transitions the way `data-dragging` does), and, for an open gesture, flips `toggleSidebar` immediately so the drawer mounts; each animation frame then writes the column's `translateX` and the scrim's opacity against the drawer width resolved at engagement. A close gesture keeps the store open and settles at release. Release snaps to the gesture's side past 35% of the drawer width and otherwise restores, comparing the vote against live state so a drawer Escape closed mid-swipe is never toggled back open. The drawer's no-transition presentation is what lets one inline `translateX` track the pointer without fighting CSS easing.

The conversation header steps aside through a data attribute, because feature plugins cannot import each other: the frame carries `data-sidebar-fab` in this band, and ui-conversation's ConversationRoot.module.css rules `[data-sidebar-fab] .header { padding-left: 60px }` (10px edge offset + 36px button + 14px clearance; attribute selectors are not CSS-module localized). Both sides record the contract in comments, the app-frame spec pins the attribute, and a style spec pins the padding rule.

## Alternatives considered

- **Keep the rail as the drawer trigger** (the batch-A decision). Rejected: on a handset the rail's price buys almost nothing, and batch A's reason for rejecting swipes — collision with the column drag handles' gesture surface — does not apply below 768px, where the sidebar drag handle never renders and the right panel cannot hold a track. Batch A's Decision section now points here.
- **Render the button from AppFrame.** Rejected: the brand mark is the sidebar's `sidebar.brand.mark` slot; a frame-owned button would fork the brand composition and the deployment replacement story that slot exists for. The frame passes one `fab` flag and the occupant keeps every pixel.
- **Drive the gesture through the layout store** (a live drawer offset in `layoutInfo`). Rejected: store writes at pointer cadence re-render the frame and the re-render would fight the gesture's own inline styles; the DragHandle refs-plus-rAF discipline already owns this interaction class.
- **CSS-transition the release snap.** Rejected: the drawer's no-transition presentation is the precondition for safe imperative tracking, and an instant settle matches the existing appear/disappear behavior.

## Consequences

- The handset center gains 56px; above 768px the rail, its geometry, and its tests are untouched, and computeColumns' contract has one AppFrame-local correction rather than a new parameter.
- The gesture constants (40px edge strip, 8px slop, 35% snap) are interaction invariants pinned by the app-frame spec's threshold, snap-back, cancel, vertical-cede, and Escape-mid-swipe cases, not deployment configuration.
- The brand mark slot gains a third render site; the generated client slot catalog records the `fab` owner flag.
- `apps/web/tests/mobile-drawer.e2e.ts` now asserts the zero track; the drawer's accessible name (`Open sidebar`) is unchanged, so the other drawer-driving e2e suites needed no changes.
