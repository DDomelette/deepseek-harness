# Agent Note: Sidebar track animation and rail glyphs after the upstream merge

Status: implemented

English | [中文](2026-10-19-sidebar-track-animation-and-rail-glyphs.zh.md)

## Problem

The upstream-alignment merge that dropped the handset drawer (recorded in 2026-10-18-handset-drawer-restored) also regressed the desktop shell's visuals in two ways.

The sidebar's expand/collapse animation disappeared. Clicking the rail toggle flipped the grid track instantly in the merged 2.0 shell while the fork's 1.5 shell animated the same click. Chromium never starts a transition whose property and duration arrive in the same style recalc as the value change, and the rewritten frame armed `data-animating` in the same commit-phase render that flipped the collapsed state, so the track change landed before the transition existed.

The collapsed rail's glyphs also lost legibility and identity. The plugins entry drew the pinwheel glyph, whose four curved blades collapse into a "prohibited" circle at the rail's 18px, and the right panel's expand button mirrored the left sidebar's collapse icon, twinning with the dock's add-tab control, whose outline-plus rides in the same corner.

## Decision

- The track transition is armed one recalc ahead of the value change: `data-animating` commits the transition's property and duration first, and the collapsed-state flip lands in a later recalc, so Chromium starts the grid-track transition on every toggle. The discrete-toggle end state (drawer, scrim) still applies instantly through `data-closing`, which suppresses transitions and animations on the first frame.
- The track easing is direction-split: an expanding track decelerates into place (`--ds-ease-out`) and a collapsing track accelerates away into the rail (`--ds-ease-in`). Both tokens live in ui-theme's base.css beside the existing `--ds-ease-in-out`.
- The right panel gets its own glyph: `IconPanelRightOutline` (Regular/Medium pair, 1px stroke) draws the panel divider at the right rail, and ui-sidebar-right's expand and collapse buttons render it instead of the mirrored `IconPanelLeftOutline`.
- The plugins rail entry redraws as `IconPluginOutline`, a single-path puzzle piece — top tab, right socket — in the same 16x16, 1px-stroke language as the rest of the set. The pinwheel artwork is removed; it had no other consumer.

## Alternatives considered

- **Reuse `IconCordisPluginOutline` for the plugins rail entry.** Rejected: the filled four-chevron brand mark clashes with the rail's 1px-stroke family, and it already denotes cordis-plugin tools in chat tool views, where it would read as a second identity for the same glyph.
- **Swap the task-manager clock for `IconChecklistOutline`.** Rejected: the checklist already denotes todo/job tool rows, and the clock's scheduled-time meaning matches automation tasks; the clock is legible at 18px, so only the pinwheel needed replacement.
- **Keep the mirrored PanelLeft glyph on the right edge.** Rejected: mirroring made the expand affordance twin with the dock's add-tab control in the same corner, and a divider-at-right glyph reads as the panel itself.
- **Fix the animation by forcing a reflow between arming and flipping.** Rejected: the two-phase commit (`data-animating` first, state second) achieves the required recalc separation inside React's own scheduling, without a synchronous layout flush.

## Consequences

The product icon set grows from 94 to 95 glyph pairs; the count assertion in ui-primitives' icon spec tracks it. Client packages resolve as built lib products, and `tsc -b` typechecks without emitting — after editing ui-primitives or a client plugin, rebuild the package's lib with tsdown before `vite build`, or the browser keeps the old glyphs from the stale lib. The two-phase arming is CSS/state-shape only; the drawer suites in ui-layout's app-frame spec pin the surrounding close paths.
