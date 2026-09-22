# Agent Note: Row tail controls open in flow and the text yields

Status: implemented

English | [中文](2026-09-22-notes-row-hover-yield.zh.md)

## Problem

[The overlay controls](2026-09-22-notes-row-overlay-controls.md) removed the seats but floated the tail controls on an opaque `--dsw-alias-bg-layer-1` backdrop over the text. The product call, again with a mock: no backdrop — the controls show directly on the card, and the text yields to them, ellipsizing into the space on their left ("Windows lane" becomes "Windows la..."), instead of being covered.

## Decision

The `.handles` wrapper is back in the row's flex flow but collapsed: `max-width: 0; overflow: hidden; visibility: hidden` at rest, opening to a generous `max-width` cap on `.row:hover` / `.row:focus-within` — the wrapper takes exactly its content's width, the select region flex-shrinks, and the title and preview ellipsize into what remains. A `max-width` transition on the theme's fast duration and in-out ease slides the opening; `prefers-reduced-motion` drops it. No measured or guessed pixel widths: the cap only bounds the animation, so the archive button's locale-varying label sizes itself. The card's own box never changes; the reveal selectors, focus ring, dragging, drop line, and the narrow-band chip fold are untouched. The backdrop and its click-through pointer-events rule are gone, and `notes-refresh.e2e.ts` clicks the row plainly again (the overlay's centre collision that prompted the positioned click no longer exists — the controls live right of the content region).

## Alternatives considered

- **Absolute overlay plus a hover-time `padding-right` on the content region.** Rejected: the padding must equal the controls' width, which varies with the archive label's locale — the in-flow collapse sizes itself.
- **Runtime measurement of the controls' width.** Rejected: the row's presentation is pure CSS today, and a layout effect per row is machinery the collapse makes unnecessary.

## Consequences

- A real-browser probe measured: at rest the title spans the full content width with the controls hidden; on hover the card's width is unchanged, the title yields (186.9px → 83.7px, ellipsized), the controls are visible with a fully transparent background and sit inside the card's right edge; keyboard focus opens them without the pointer.
- This supersedes the backdrop half of [the overlay note](2026-09-22-notes-row-overlay-controls.md) — its seat removal and reveal semantics stand; cross-linked both ways.
- All 433 notes package tests pass unchanged; the `notes-refresh` golden is unchanged.
