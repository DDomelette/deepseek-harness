# Agent Note: Selection bubble placement and dismissal

Status: implemented

English | [中文](2026-09-21-notes-selection-bubble-placement.zh.md)

## Problem

The notes selection bubble (`SelectionBubble.tsx`) positioned itself at the selection's horizontal midpoint with `transform: translate(-50%, calc(-100% - 8px))` and never revisited that decision:

- No viewport clamping: a selection near the left, right, or top edge pushed the bubble off-screen.
- No scroll tracking: only `selectionchange` repositioned it, so scrolling the conversation left the bubble hanging over whatever text replaced the passage.
- No dismissal besides the selection collapsing on its own: neither Escape nor scrolling closed it.
- `z-index: 70` was an unexplained value; it painted over floating windows (60) that the reader deliberately placed.

## Decision

Placement is computed by an exported pure `placeBubble(viewport, anchor, size)` in `SelectionBubble.tsx`: the bubble centers on the selection but clamps to the viewport with an 8px margin (a bubble wider than the viewport centers instead of clamping), and flips below the selection when the space above is shorter than the bubble plus the 8px gap. The component measures the rendered bubble in a `useLayoutEffect` — placement needs the bubble's own size, which exists only after render — and React applies the result before paint, so no hidden-until-placed state is needed. The chosen side rides a `data-notes-bubble-side` attribute so the flip's transform stays in the stylesheet.

Dismissal follows two existing product conventions. Escape: a document `keydown` listener active only while the bubble shows consumes the key with `preventDefault()` and skips an already-`defaultPrevented` one — the topmost-surface Escape convention ([commit 21ee6424a1](https://github.com/deepseek-ai/deepseek-harness/commit/21ee6424a1), e.g. `AppFrame` skipping a consumed Escape). Scroll: the bubble closes rather than tracking, because a fixed-position bubble cannot stay glued to scrolling text without per-frame re-measurement, and a clamped bubble parked at the viewport edge over unrelated text reads as a bug; scroll events do not bubble, so the listener sits on `window` in the capture phase to reach the conversation's inner scroller. A window resize keeps the selection, so the bubble re-measures instead of closing.

The z-index becomes 30 with the layer map recorded in the stylesheet: conversation chrome belongs above the frame's overlay layer (20, AppFrame) and the docked right panel (10), and below floating windows (60, FloatLayer) and tooltip chrome (100, ui-primitives).

## Alternatives considered

- **Track the selection on scroll with per-event re-measurement.** Rejected: the bubble would follow the text only between scroll frames and, once the passage scrolled off-screen, clamp into the viewport edge over unrelated content; closing is the behavior readers already get when the selection collapses, and it is one listener with no positioning math.
- **Anchor with a floating-ui style middleware stack.** Rejected as dependency weight for one toolbar: the placement is twelve lines of arithmetic with full branch coverage, and no other part of the panel needs the library.
- **Keep z-index 70 (above floating windows).** Rejected: a floating window is a surface the reader positioned deliberately; transient conversation chrome painting over it inverts the window metaphor.

## Consequences

- `notes-bubble.client.spec.tsx` grows placement unit tests (clamp both edges, wider-than-viewport, flip) and dismissal tests (Escape consumes, consumed Escape ignored, non-Escape ignored, capture-phase scroll hides, resize re-measures); `SelectionBubble.tsx` stays at 100% coverage. A real-browser probe (Chromium, built app) measured the bubble centered on the selection range to within a pixel, above it with the 8px gap, dismissed by scroll and Escape.
- The bubble no longer paints over floating windows; nothing else in the product used the bubble's old layer.
- A selection that scrolls away loses its bubble and must be re-selected to collect — accepted as the predictable behavior.
