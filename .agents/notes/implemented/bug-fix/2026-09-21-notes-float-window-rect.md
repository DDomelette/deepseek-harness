# Agent Note: Notes float window opens at its own rectangle

Status: implemented

English | [中文](2026-09-21-notes-float-window-rect.zh.md)

## Problem

The notes panel's "Float as a window" control called the [right-sidebar docking surface's](../feature/2026-09-04-right-sidebar-docking-infrastructure.md) `float(tabId)` without a rectangle, so the window took the dockkit cascade default: 380×300 (`FLOAT_DEFAULT_SIZE`) at (160,120) (`FLOAT_ORIGIN`). Measured in a real browser: the window opened ~380×280 over the left sidebar, and at that width the panel fell below its own 560px two-column band — the navigation bar wrapped and the title ellipsized to "对..对话", leaving the floated panel effectively unreadable.

## Decision

The notes face now passes an explicit rectangle. `notesFloatRect(viewport)` in `packages/notes/notes/src/client/face.ts` returns 640×480 clamped to the viewport minus a 24px margin, flush against the viewport's right edge (where the docked column sat) and centered vertically; `present` computes it from `window.innerWidth/innerHeight` at click time and hands it to `frame.float(tab, rect)` — the sidebar-right service already accepted an optional rect, so the host mechanism is unchanged. 640px lands the panel inside its two-column container-query band, so the floated window shows the same layout as a wide docked pane.

The docked column showing the pane's next tab ("文件") after the notes tab floats is the surface's generic behavior for every floated tab — a floated-away placeholder would be a host-level feature, and this fix deliberately does not touch it. The dockkit-wide `FLOAT_MIN_SIZE` (220×140) still governs manual resizing below a readable width; that floor is the kit's contract for all panes and stays.

## Alternatives considered

- **Raise the dockkit defaults (`FLOAT_DEFAULT_SIZE`, `FLOAT_ORIGIN`) for every pane.** Rejected: the cascade default is the [docking surface's](../feature/2026-09-04-right-sidebar-docking-infrastructure.md) generic contract shared by drag-out floats of every tab type; sizing it for the notes panel's two-column layout would push a notes-specific need onto every other pane, and a fixed origin cannot know where the tab's docked column was.
- **Change the panel's container-query breakpoints so the two columns fit a 380px window.** Rejected: 240px of list leaves ~140px of detail, which is exactly the unreadable squeeze being fixed; the panel's bands are measured for its content and stay.

## Consequences

- The floated window opens readable at 640×480 on any viewport at least 688×528, shrinks proportionally below that, and never opens over the left sidebar; `notes-face.client.spec.ts` pins the rectangle math for wide, narrow, and short viewports, and a real-browser probe (Chromium against the built app, 1680×1000) measured exactly `{ x: 1016, y: 260, width: 640, height: 480 }` with a one-row toolbar.
- Manually resizing below ~560px still drops the panel to its one-column band, as designed for narrow panes.
- The float control remains notes-only; other tabs float by drag with the kit's cascade default, unchanged.
