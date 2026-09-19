# Agent Note: Mobile responsive layout, batch A

Status: implemented

English | [中文](2026-09-13-mobile-responsive-batch-a.zh.md)

## Problem

Phones reach the Web UI through [LAN Web serving](../architecture/2026-09-11-lan-web-serving.md), but the shell shipped only a desktop layout. Below the 1024px sidebar auto-collapse, a manually expanded sidebar squeezed the conversation column into a handset-width remnant; the conversation content width floored at a fixed 680px, overflowing a ~390px handset column; the width drag handles and the input bar's sub-44px buttons assumed a mouse; and the `100vh` height chain plus a viewport meta without `viewport-fit` or `interactive-widget` left the composer under the mobile URL bar and the home-indicator band.

## Decision

The frame gains a handset band. `SIDEBAR_OVERLAY = 768` in `packages/client/ui-layout/src/client/columns.ts` splits the narrow range: between 768px and the 1024px `SIDEBAR_AUTO_COLLAPSE` the squeeze behavior is unchanged, while below 768px an expanded sidebar leaves the column grid — the solve keeps the 56px rail, and the column floats over the center as a drawer (`data-drawer`) behind an aria-hidden scrim (`data-drawer-scrim`). A scrim tap or the Escape key closes it through the same `toggleSidebar` action; the rail stays the drawer's trigger, and the sidebar drag handle does not render beneath the drawer. The layout store flips `narrowExpanded` instead of a width preference below 1024px, and drops that override when the viewport crosses the 768px or 1024px breakpoint in either direction, so each band opens collapsed.

The center and right sidebar explicitly occupy grid columns 2 and 3. A fixed drawer contributes no grid item; automatic placement would put the center in the 56px rail, reflow long transcripts, and clamp their scroll position when the drawer closes. Explicit columns preserve the content width across drawer toggles.

ui-conversation fits the content width axis to the column. The content width clamp floors at `min(680px, column)` instead of a fixed 680px, so below 680px the floor degrades to the column itself and a handset column never overflows; the 64% adaptive term and the 920px line-length cap are unchanged. The width handles are a mouse facility and hide under `(max-width: 767px), (pointer: coarse)`. The sticky composer seat adds `env(safe-area-inset-bottom)` padding to clear a handset's home-indicator band, and on coarse pointers the input bar buttons carry a 44px minimum touch target (WCAG 2.5.5).

`apps/web` declares `viewport-fit=cover` and `interactive-widget=resizes-content` in the viewport meta, and the shell height chain (`html`, `body`, `#root`) uses `100dvh`, so the layout tracks the mobile browser's dynamic viewport as the URL bar collapses and the keyboard resizes the content. The mount root also carries the top and inline safe-area insets (`env(safe-area-inset-top)` and `env(safe-area-inset-left/right)`) under `box-sizing: border-box`, so an installed PWA's status bar and a landscape notch cannot overlap the header or the sidebar toggle; the bottom inset stays with the composer seat that meets the home indicator.

Before the root ref publishes the first column measurement, the width axis uses 680px as its cap, with each content element constrained to `width: 100%`. Child layout effects can restore saved scroll anchors before the parent ref runs; a zero-width fallback would restore against a collapsed transcript and lose the reading position when measurement expands it.

Browser coverage uses `newMobilePage` (390×844, touch). The [drawer scenarios](../../../../apps/web/tests/mobile-drawer.e2e.ts) check horizontal overflow, drawer dismissal, stable center width, composer visibility before and after measurement, and safe-area padding. The [Chat scroll scenarios](../../../../apps/web/tests/chat-scroll-contract.e2e.ts) navigate sessions through the drawer and retain their reading anchors and bottom-follow state after it closes.

## Alternatives considered

- **Replace the shell's slot skeleton for narrow viewports.** Rejected: the composed shell's sub-slot declarations and owner-props contracts would each need a rewrite, which is too costly for the first handset pass.
- **A separate `ui-mob-shell` package.** Rejected for the same reason: it forks the slot composition and every owner contract instead of adapting one shell.
- **Swipe gestures to open and close the drawer.** Rejected for this batch: an edge swipe collides with the column drag handles' gesture surface, so the drawer opens and closes only through the rail button, scrim tap, and Escape.

## Consequences

- The desktop path is untouched: every new branch keys off the 768px constant or a coarse-pointer media query, and the desktop e2e golden scenarios replay green.
- iOS safe-area and keyboard behavior is not verifiable in CI; it is an accepted gap covered by manual device checks, while the mobile lane pins the zero-inset case where every requested inset must resolve to no padding.
- Secondary surfaces outside the conversation shell keep the desktop layout; the Settings panel has its own handset layout ([Single-pane settings on a handset](2026-09-13-settings-single-pane-handset.md)), and the fixed overlays that cover the phone screen take the safe-area insets as their own spacing ([Mobile follow-ups, batch B](2026-09-13-mobile-follow-ups-batch-b.md)).
