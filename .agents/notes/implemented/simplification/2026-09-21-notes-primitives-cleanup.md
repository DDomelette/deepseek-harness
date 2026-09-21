# Agent Note: Notes panel primitives cleanup

Status: implemented

English | [中文](2026-09-21-notes-primitives-cleanup.zh.md)

## Problem

A design walkthrough of the notes panel found three kinds of drift: dead styles nobody renders, hand-rolled copies of control recipes that ui-primitives already owns, and small geometry defects.

- `NotesPanel.module.css` carried a complete second copy of the material list's styles (`.list` through `.rowSource`) that `MaterialList.tsx` never reads — and the copy had silently broken a live rule: the one-column band's `.panel[data-notes-selected] .list { display: none }` names this module's `.list`, a class no element carries, so below 560px an open detail squeezed in beside the list instead of replacing it.
- The toolbar-button recipe (tool-bar fill + 0.5px border + radius + hover) was hand-copied across the row handle, the locate control, and the detail's five actions; the primary recipe existed twice (empty-state create, thread send).
- The list column held a fixed 240px at every panel width, and a two-column pane with nothing opened left the detail side blank.

## Decision

The cleanup keeps every `data-notes-*` hook and visible behavior unless stated:

- Dead CSS deleted after zero-reference greps: the NotesPanel list block, and `NotesSettingsCard.module.css`'s `.actions`/`.actionRow` (a read-only action list that no longer exists). The one-column hide rules now select `[data-notes-materials]` / `[data-notes-detail]` — attributes, which CSS Modules do not scope — and the full-width list override moved into `MaterialList.module.css`, where `.list` actually lives. A real-browser probe confirmed the fix: at a 544px panel an open detail hides the list.
- The row archive handle, the locate control, and the detail's action buttons render as ui-primitives `Button` (`sm`, `outline`); the empty-state create and the thread send render as `Button` `primary` (`md` and `sm`). The handle keeps its PR-#56 seat — an in-flow slot toggled by `visibility` on row hover/focus — as a small class on the shared Button; the settings card's own copies stay for the settings pass, out of scope here. Its `.addFeature` gained the `align-self: flex-start` its flex-column section needs, the one in-scope fix there.
- The list column flexes with `clamp(220px, 32%, 340px)`; below the two-column band it is the whole pane as before.
- With no material open, the detail side shows a guidance empty state (icon + one localized line, `detail.empty`), hidden in the one-column band where the list alone shows.
- Misc: the status dots draw with `border-radius: 50%` + `corner-shape: round` instead of a square-ish 8px radius; `panel.restore`'s Chinese line now reads 取回置顶, matching "Restore to top". The header-corner notes button keeps its 15px glyph on purpose: the seat's convention (ExpandButton and the sidebar's own controls) is a 28px circle around a 15px glyph, and changing one control would break the row's rhythm.

## Alternatives considered

- **Keep the narrow-band rules in `NotesPanel.module.css` with scoped class names.** Rejected: that is exactly how the rule rotted — the scoped `.list` silently matched nothing. Attribute selectors name what the elements actually carry.
- **Fix the one-column hide in its own PR.** Rejected: the fix is inseparable from deleting the dead block that caused it — the same lines.
- **Extend `Button` with a bordered-toolbar variant to match the old recipe pixel-for-pixel.** Rejected: `outline` is the product's bordered idiom (SettingsDocumentAction); preserving a hand-rolled look would defeat the convergence.

## Consequences

- ~120 lines of dead or duplicated CSS leave the package; the button recipes exist once, in ui-primitives.
- The one-column band now actually hides the list when a detail opens — a behavior fix riding a cleanup, verified in Chromium at 544px.
- The `notes-refresh` web e2e golden needed no change: ARIA roles and names are identical after the Button swap.
- All 401 package tests pass with the changed sources at 100% coverage; the empty state is asserted in `notes-panel.client.spec.tsx`.
