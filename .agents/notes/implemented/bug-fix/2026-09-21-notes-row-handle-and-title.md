# Agent Note: Notes list row handle and conversation title legibility

Status: implemented

English | [中文](2026-09-21-notes-row-handle-and-title.zh.md)

## Problem

Two measured defects in the notes panel (`packages/notes/notes/src/client/`):

- A material row's archive handle was `position: absolute; right: 4px; display: none`, revealed by `.row:hover` alone. It painted over the row's own source label (a measured 22×15px overlap), and because `display: none` is unreachable by keyboard, the handle could never be focused or revealed by focus.
- The conversation trigger in the navigation bar carried `min-width: 0` beside six `flex: none` tool buttons, so flex shrinking crushed it first: the title rendered as "笔记 ·" (measured 45px wide against a 72px content width). Ellipsis also could not engage because the title text sat in an anonymous flex item.

## Decision

`MaterialList.module.css` moves the handle into the row's own flex flow (`flex: none; margin-right: 4px`) and toggles `visibility` instead of `display`: the seat is always reserved, so revealing the handle covers nothing and moves nothing. The reveal selectors are `.row:hover` and `.row:focus-within`, and the handle gains the shared `:focus-visible` indicator (2px `--dsw-alias-brand-primary` outline, as in the ui-primitives Switch). Row dragging and the drop line are untouched: the `<li>` keeps `draggable` and the line stays a `box-shadow` on the row.

`NotesPanel.tsx` wraps the conversation title in a `conversationTitle` span that owns the ellipsis (`overflow: hidden; min-width: 0; text-overflow: ellipsis; white-space: nowrap`), and `NotesPanel.module.css` gives the trigger `flex: 0 1 auto; min-width: 10em` — roughly eight CJK characters of title stay readable before ellipsis — while keeping `max-width: 60%` as the ceiling in wide panes. The tool-label container query moves from 499px to the existing 559px one-column switch so the 500–559px band (labeled tools plus the title floor) cannot overflow the bar; below 560px the panel shows one column, and the same controls carry icons alone.

## Alternatives considered

- **Keep the handle absolute and reserve right padding on the row button.** Rejected: the reservation must guess the handle's width, which varies with locale ("归档" vs "Archive"); the in-flow seat sizes itself.
- **Toggle `display` on the in-flow handle.** Rejected: appearing and disappearing would reflow the row's text on every hover, the jitter the fix exists to remove.
- **Let the bar wrap instead of hiding labels below 560px.** Rejected: a two-row bar costs every narrow pane vertical space, and the icon-only treatment already exists as the ≤499px behavior — extending it to the one-column band reuses a shipped pattern instead of adding a third layout.

## Consequences

- The handle never overlaps row content, appears on keyboard focus as well as hover, and shows a visible focus ring; every row permanently reserves the handle's width, so titles ellipsize slightly earlier.
- The conversation title keeps at least ~8 characters at any pane width, ellipsizes correctly beyond that, and the 500–559px band shows icon-only tools instead of an overflowing bar.
- `packages/notes/notes/tests/notes-list.client.spec.tsx` and `notes-panel.client.spec.tsx` (63 tests) pass unchanged — they assert `data-notes-*` hooks and locale text, not CSS classes — so no selector or golden-file update was needed.
- Superseded in part by [the overlay controls](2026-09-22-notes-row-overlay-controls.md): the tail controls now float over the card's right edge and reserve nothing at rest; this note's hover/focus reveal and focus ring are unchanged.
