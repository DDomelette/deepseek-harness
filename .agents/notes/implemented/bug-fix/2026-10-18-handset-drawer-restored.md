# Agent Note: Restore the handset drawer the upstream merge dropped

Status: implemented

English | [中文](2026-10-18-handset-drawer-restored.zh.md)

## Problem

The upstream-alignment merge (`511389989c`) took upstream master for the client shell and re-applied only part of the fork's handset band: `SIDEBAR_OVERLAY`, the `data-sidebar-fab` frame marker, the sidebar slot's `fab` floating brand button, and the consumer stylesheets that key on the marker all survived. The drawer presentation did not. Upstream's rewritten `AppFrame` carried no drawer, so the fork's `data-drawer` column, scrim, slide-in/out, edge swipe, and Escape handling were dropped with it, and the merge left the overlay band's switch (`cols.sidebar = 0` below 768px) without any visible open state.

The result was a one-way trap. Below 768px the floating brand button was the sidebar's only opener; tapping it set `narrowExpanded` and unmounted the button, while the expanded sidebar rendered into a zero-width grid column and was clipped to nothing. No scrim, no Escape owner, no rail toggle, and a stray drag handle at x=0 remained. Reproduced on the merged tree: after the tap, the frame's grid computed `0px + center + 0px` and the sidebar element measured 0×0. Desktop widths were unaffected, which is why the regression survived the merge's own checks.

## Decision

The fork's 1.5 drawer is ported onto the upstream-rewritten frame (`packages/client/ui-layout/src/client/AppFrame.tsx`), keeping the upstream machinery it now lives beside:

- `drawerOpen = overlay && !sidebarCollapsed` derives the presentation; the closed sidebar still owns no track, and the column floats over the center as a fixed-position `data-drawer` with an aria-hidden scrim. Enter rides a mount-scoped keyframe, exit a delayed unmount (`DRAWER_SLIDE_MS`), and a swipe-driven mount tracks the pointer instead of replaying the keyframe.
- The edge swipe is touch-pointers-only: a right swipe from the frame's left 40px opens under the pointer, a left swipe closes, and release snaps past 35% of the drawer width. Inline styles own the tracked position while the store flips only at engagement and release.
- The drawer is the lowest-priority Escape owner; a scrim tap, an unconsumed Escape, the sidebar's collapse control, and panel selection all close it through the same `toggleSidebar` action. `stores.ts` folds the dismissal into `selectPanel` for the overlay band only, and `setViewportWidth` drops the narrow-expansion override across both the 768px and 1024px breakpoints.
- The sidebar slot keeps the wide owner parameters (`collapsed: false`, `drawerWidth`) through the slide-out so the column never swaps to the floating button mid-slide, and the sidebar drag handle is guarded out of the overlay band.

`service.ts` regains the contract lines for selection-as-drawer-dismissal, and the ui-layout README documents the band again in both languages. The behavior is pinned by the drawer suites in `tests/app-frame.client.spec.tsx` and the two restored tests in `tests/layout-store.client.spec.ts` (ui-layout: 7 files, 142 tests).

## Alternatives considered

- **Drop the overlay band and follow upstream: the rail stays at every width.** Rejected: the fork's handset work — the fab, the two-row conversation header, the composer clearance rules, and their tests — all key on `data-sidebar-fab`, and the drawer is the band's only way to open the sidebar. Keeping the band without the drawer preserves the trap.
- **Render the drawer inside ui-sidebar instead of the frame.** Rejected: the frame owns the column's presentation (grid tracks, drag handles, scrim stacking above the center), and the fork already had a reviewed implementation to port; splitting ownership would re-litigate the frame/sidebar boundary the README defines.
- **Keep the half-merged state and document the dead end.** Rejected: a documented trap on phones is still a trap, and the cost of the port is bounded — 1.5's implementation, CSS near-verbatim, TSX adapted to the `data-animating` track easing.

## Consequences

Track easing (`data-animating`) is a no-op for drawer toggles: the overlay band's sidebar track is `0px` in both states, so the discrete-toggle counter fires without a visible transition. Overlay-band mice keep text selection because the swipe is touch-only; they drive the drawer through the fab, the scrim click, and Escape. The remaining handset gaps the same merge left — the settings single-pane layout, the safe-area insets, and two handset CSS overrides — are recorded in the review that found this regression and are follow-up work, not part of this decision.
