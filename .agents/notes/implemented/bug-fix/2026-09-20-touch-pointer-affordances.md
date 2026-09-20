# Agent Note: Touch-pointer affordances for tooltips and collapsed selectors

Status: implemented

English | [中文](2026-09-20-touch-pointer-affordances.zh.md)

## Problem

A handset review (390×844 touch emulation) surfaced two touch-pointer semantics defects in the Web client, and one suspected third:

- A tap on the rail's `Open sidebar` button left its tooltip bubble stuck over the session title area in every later screenshot. The shared `Tooltip` primitive raises its bubble on `mouseenter` and on `focus`; a tap synthesizes `mouseenter` and leaves the anchor focused, and no touch gesture produces the `mouseleave` or `blur` that would hide the bubble.
- The composer's permission and model triggers collapse to bare icons on narrow rows — `PermissionSelect.module.css` drops `.triggerLabel` below a 460px container cut, `ModelSelect.module.css` swaps all text for the Models glyph below a 360px container cut (both against the anonymous InputBar `.row` container). The collapse stays meaningful only through the trigger's `title`, which touch cannot reveal, so a sighted touch user faces an anonymous shield and an anonymous data glyph.
- Suspected, unconfirmed: selecting an option in the question card looked like it reset the card's scroll position to the top.

## Decision

- `packages/client/ui-primitives/src/Tooltip.tsx` gates the bubble on `(hover: hover) and (pointer: fine)`, evaluated when a trigger fires, in the one shared layer every call site uses. Hover and focus channels both go through `show()`, so both are covered; the anchor's accessible name already lives on its `aria-label`, so touch users lose no semantics. Where the engine reports no `matchMedia` (the jsdom unit lane), the desktop answer stands.
- Both selector stylesheets append a `@media (pointer: coarse)` override after their container query (equal specificity, later source order wins): the permission trigger keeps its label, and the model trigger keeps name/effort text instead of the stand-in glyph. Fine-pointer layouts are untouched — the override is inert there. No new copy: the existing labels already ellipsize inside their caps (`max-width: 220px`, `min(360px, 45cqw)`), and the composer row's `flex-wrap: wrap` absorbs any residual pressure before the send button is at risk — verified by measuring the send action's hit-test at 390×844.
- The suspected scroll reset was reproduced first: a programmatic option click leaves the scroll region's `scrollTop` untouched (137 → 137), while a Playwright click on an out-of-view option scrolls it into view (137 → 12). The observed jump is Playwright's actionability scroll, not a product bug; no code changed for it.

## Alternatives considered

- **Gate tooltips per call site.** Rejected: every tooltip in the client flows through the one ui-primitives component, so per-callsite `disabled` props would duplicate the same pointer query across a dozen packages and invite the next call site to forget it.
- **Micro-label under the icon (a 9-10px caption row).** Rejected: it grows every trigger's height for all users to fix a coarse-pointer-only gap, while the existing short labels already fit — the permission presets are one to three words, and the model name ellipsizes to an informative prefix inside its 45cqw cap.
- **Show the current value at the top of the opened menu.** Rejected as redundant once the trigger stays labeled: the menu's option rows already carry full labels with the current one checked, and the defect was the anonymous trigger, not the menu.
- **Treat the question-card scroll jump as a product bug.** Rejected after reproduction (above): it is the test driver's scroll-into-view, and changing product behavior for it would fix nothing a user can hit.

## Consequences

- On touch, taps never raise tooltip bubbles; on hover-capable pointers nothing changes, including keyboard focus tooltips.
- At 390×844 with touch emulation the permission and model triggers render their labels, and the send action stays inside the viewport and hit-testable; the desktop narrow-window collapse to icons is unchanged.
- `ui-primitives/tests/tooltip.client.spec.tsx` stubs `matchMedia` for both pointer arms; `apps/web/tests/mobile-drawer.e2e.ts` asserts no tooltip after the rail tap, labeled selectors, and a tappable send action on the touch page.
