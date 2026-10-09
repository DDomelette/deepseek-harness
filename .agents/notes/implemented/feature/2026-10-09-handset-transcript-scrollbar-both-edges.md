# Agent Note: Handset transcript scrollbar: restored with a symmetric gutter

Status: implemented

English | [中文](2026-10-09-handset-transcript-scrollbar-both-edges.zh.md)

## Problem

[Handset device pass](../bug-fix/2026-10-08-handset-device-layout-fixes.md) hid the transcript scrollbar in the handset band: on the paired device's browser the classic bar takes layout width, and the unconditional `scrollbar-gutter: stable` reservation shifted the centered content column left by half the reserved width. Hiding fixed the centering but removed the scroll affordance entirely — no position hint, no drag target — and the user asked for the bar back without losing the centering.

## Decision

The handset band keeps the bar and reserves the gutter symmetrically: `[data-sidebar-fab] .scrollBody { margin-right: 0; scrollbar-gutter: stable both-edges }`. On classic-scrollbar engines the left gutter mirrors the bar's width, so the content box stays symmetric and the centered column keeps the viewport center; on overlay-scrollbar engines (the common handset case) the bar consumes no layout and the gutter reserves nothing, so nothing shifts. `stable` (not bare `both-edges`) keeps the reservation constant so the column never jumps when the transcript starts overflowing. The 2px bar offset stays dropped in this band, and the overlay-composer scroller keeps its own `scrollbar-gutter: auto` (later equal-specificity rule) with the handset seat compensation untouched — that box never scrolls, so it never hosts a bar. ui-chat's TurnNavigator overlay scroller keeps its hidden bar: a floating navigation layer has no centered column to protect and no room for a gutter.

## Alternatives considered

- **Keep the bar hidden** (the device-pass stance). Superseded by the user's direction: the scroll affordance is wanted back, and the symmetric gutter removes the centering cost that justified hiding.
- **Show the bar with a hand-computed left compensation** (`scrollbar-width: thin` plus a matching left margin). Rejected: the bar's width varies by engine (WebKit `::-webkit-scrollbar` widths are author-controlled, Firefox's `thin` is not), so the compensation cannot stay exact; `both-edges` reserves the engine's own width by construction.
- **A custom overlay scrollbar that appears while scrolling** (JS-driven indicator or a library). Rejected: it is the closest to the native handset feel, but it means owned scroll-listener and auto-hide logic — or a new dependency — for an affordance the engine already provides.

## Consequences

- Classic-scrollbar platforms in the handset band give the transcript a visible bar at the cost of a symmetric strip on the left (one bar width each side); overlay platforms are pixel-identical to before.
- The mobile-drawer e2e's computed-style pin moves with the behavior (`stable both-edges` / `auto`); the composer-tab-geometry lane is untouched (its narrow viewport stays above the overlay breakpoint).
- This reverses one point of [Handset device pass](../bug-fix/2026-10-08-handset-device-layout-fixes.md) (bar hidden, gutter dropped); its shipped-fact sentences point here. The desktop `scrollbar-gutter: stable` reservation of [Composer tab gutter reservation](../../archived/bug-fix/2026-08-04-composer-tab-gutter-reservation.md) is untouched.

## Related

- [Handset device pass](../bug-fix/2026-10-08-handset-device-layout-fixes.md) — the hide this note partially reverses.
- [Handset Session header: two-row title layout](../feature/2026-10-09-handset-session-header-two-rows.md) — the sibling handset-band change in the same iteration.
