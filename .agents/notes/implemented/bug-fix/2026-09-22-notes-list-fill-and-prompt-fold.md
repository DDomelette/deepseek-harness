# Agent Note: Row card fills its column, and the prompt template folds into the source card

Status: implemented

English | [中文](2026-09-22-notes-list-fill-and-prompt-fold.zh.md)

## Problem

Two walkthrough findings on the notes panel:

- A material row's card never reached the list column's right edge: the card chrome (padding, border, hover fill) lived on the select button (`flex: 1`), while the archive and `⋯` controls kept their visibility seats *outside* it in the row, so the card stopped short of the column edge and the title squeezed against the action chip in what remained (measured in a real browser: a 242px column left the title ~40px).
- After the source strip folded behind the head's disclosure, the prompt template still occupied its own top-level section, splitting "where this came from" across two places.

## Decision

The row IS the card now (`MaterialList.module.css`): the chrome moved from the select button to the `<li>` — hover fill on the row, the open state on the row's existing `data-notes-open` attribute, the drop line untouched — and the button is the card's chromeless content region. The tail controls keep their in-flow visibility seats, now inside the card boundary, and the title takes `flex: 1` with `min-width: 0`, so it claims every pixel the chip and the seats leave and ellipsizes past it. In the two-column band's narrowest panes (560–640px, where the list clamps to 220px) the action chip folds away so the title keeps about six characters; one-column panes give the list the full width and keep the chip. No DOM change: the selectors moved, the elements did not.

The prompt template moved into the source card (`MaterialDetail.tsx`): the card is now a column — source row, then the template with its own heading and the same first-line fold it had as a standalone section. The detail body no longer carries a template section; the template's collapse/expand behavior and its `data-notes-action-template` hook are unchanged.

## Alternatives considered

- **Overlay the hover controls on the card's right end.** Rejected: they would cover the title's tail on hover, the exact defect the in-flow seats exist to prevent, and two controls' width varies with locale.
- **Shrink the seats (icon-only archive, tighter padding).** Rejected: the row's controls are the shared sm `Button`, and per-control geometry overrides would reopen the recipe duplication the primitives convergence closed.
- **Let the template scroll inside the source card instead of folding.** Rejected: the fold already exists and reads better for long prompts; a second scrolling region inside the card adds a scrollbar for a text that is usually two lines.

## Consequences

- A real-browser probe measured the card spanning the column's content box to within a pixel, the chip inside the card, the title ellipsizing in the space left for it, and both hover controls appearing inside the card boundary.
- The template fold lives behind the disclosure; `notes-detail.client.spec.tsx` opens the disclosure before asserting the template, and the `notes-refresh` golden needed no change (its material names no action).
- Dragging, the drop line, and the keyboard focus reveal are unchanged; all 433 package tests pass with `MaterialList.tsx` and `MaterialDetail.tsx` at 100% coverage.
