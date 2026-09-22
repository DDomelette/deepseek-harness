# Agent Note: Row tail controls float over the card edge

Status: implemented

English | [中文](2026-09-22-notes-row-overlay-controls.zh.md)

## Problem

The in-flow visibility seats that [the row-handle fix](2026-09-21-notes-row-handle-and-title.md) introduced reserve the tail controls' width at all times — about 110px with two controls (archive + `⋯` menu) — so a material row's title ellipsized early even while nothing showed (measured: a 242px column left ~40px of title). The product call, with a mocked-up screenshot: the title and preview take the full card width at rest, and the controls float over the card's right edge on hover or focus, allowed to cover content.

## Decision

The seats are gone (`MaterialList.module.css`): the row is `position: relative` again, and the two controls sit in one absolutely positioned `.handles` wrapper at the card's right edge, vertically centered. The wrapper carries an opaque `--dsw-alias-bg-layer-1` backing with a little left padding so the controls stay readable over the text they cover, and it takes no pointer events itself — only the buttons do (`.handles button`), so a click on the backdrop falls through to the row's select. Reveal stays `.row:hover` / `.row:focus-within` with the shared `:focus-visible` ring; absolute positioning moves no layout, so appearance is still jitter-free. The drop line, dragging, and the narrow-band chip fold are untouched.

The e2e surfaced one real collision the seats had hidden: at the narrowest cards the visible overlay's archive button reaches the row button's horizontal centre, where Playwright (and a quick reader) clicks to select. The backdrop's click-through covers the padding; the button itself remains a real target, and `notes-refresh.e2e.ts` now clicks the row's text end — the gesture a reader selecting a row actually makes.

## Alternatives considered

- **Keep one seat (the fixed-width `⋯`) and float only the archive button.** Rejected: a half-reserved, half-floating row reads as two layouts, and the `⋯` alone still costs ~36px everywhere for a control that is used rarely.
- **A left fade gradient under the controls** (the composer's fade band). Rejected as unneeded: the buttons are solid chips with their own borders, and the row is short enough that the text they cover is already ellipsized.

## Consequences

- A real-browser probe measured the rest state (content region spans the full card minus padding; the title is ~191px where the seats left ~40px), the hover state (identical geometry — zero jitter — with the controls visible on an opaque backing inside the card's right edge), and keyboard focus revealing the controls without the pointer; a second probe verified backdrop click-through selects the row while the Archive button still archives.
- [The row-handle note](2026-09-21-notes-row-handle-and-title.md)'s in-flow-seat decision is superseded by this one; its keyboard-reveal and focus-ring decisions stand unchanged.
- Superseded in part by [the hover-yield follow-up](2026-09-22-notes-row-hover-yield.md): the backdrop and its click-through rule are gone — the controls open in flow at the card's right end and the text yields to them.
- All 433 notes package tests pass unchanged; the `notes-refresh` golden is unchanged (the overlay is hidden at rest, so ARIA never sees it).
