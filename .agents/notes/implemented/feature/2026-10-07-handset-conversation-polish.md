# Agent Note: Handset polish: shared content column, drawer slide, single-line composer row

Status: implemented

English | [中文](2026-10-07-handset-conversation-polish.zh.md)

## Problem

Device verification of [Handset sidebar: floating brand button and edge swipe](2026-10-07-handset-sidebar-fab-swipe.md) left three handset-only rough edges. On the conversation page the message column and the input card read as left-shifted and misaligned: below 768px the width clamp floors W at the column width, but the transcript kept its `clearance + 16px` side pads while the card clears the bare clearance, so the shared width axis degenerated into two different insets (32px vs 16px) whose left edges no longer agreed. The drawer appeared and vanished with no positional motion, which read as abrupt next to the scrim it travels with. And the composer's button row (attach, permission chip with shield + label + chevron, model chip, send) wrapped onto two lines at phone width.

## Decision

All three changes key off the frame's `data-sidebar-fab` attribute (the established cross-package contract for the overlay band); wide-screen behavior is untouched.

ui-chat's transcript scroller drops the extra 16px inset in this band (`[data-sidebar-fab] .scroll { padding-inline: clearance }`), so the message column and the input card share one symmetric 16px-inset centered column with aligned left edges. The shared width rule (transcript = card − 32px) is deliberately a non-handset rule: with W floored at the column width, the extra inset could only split the axis. The persisted `--dsh-chat-user-width` drag preference was investigated and cleared — both boxes clamp to the same axis at any W at or above the column width, so it cannot produce the bias.

The drawer slides. Enter rides a mount keyframe (`drawer-in` from `translateX(-100%)`; the scrim fades with `scrim-in`), because a mounting element cannot transition. Exit is a delayed unmount: AppFrame keeps the column and scrim mounted for `DRAWER_SLIDE_MS` (300ms, matching `--ds-transition-duration-slow`) under `data-closing`, whose stylesheet end state (`translateX(-100%)`, scrim `opacity: 0`) the base transition reaches from the current position; a reopen inside the window cancels the unmount, and leaving the overlay band ends it at once. The closing flag is derived during render (React's adjust-state-on-prop-change pattern), not in an effect: an effect commits one fully-unmounted frame before the closing marker lands — a visible flash, and a barrier waiting for the scrim to detach releases into the slide-out window (the chat-scroll restore scenario's `waitFor(detached)` raced exactly that flash). During the window the sidebar slot keeps the wide owner parameters (`collapsed: false`), so the column never swaps to the floating button mid-slide, and the scrim is pointer-transparent. The edge swipe integrates at two points: a swipe-opened mount carries `data-gesture-driven` for the mount's whole life so the enter keyframe — which would override the gesture's inline tracking — never runs, and on a release that votes to close, the gesture keeps its inline position until the closing styles land (one rAF after the toggle's commit), so the slide-out starts exactly where the finger left it; releases that keep the drawer clear the inline position immediately and let the base transition animate the settle. Scrim tap, Escape, the sidebar's collapse control, and the swipe all exit through the same window. Reduced-motion keeps the instant end state.

The docked composer's button row holds one line: `[data-sidebar-fab] .root[data-composer-variant='composer'] .row { flex-wrap: nowrap }`, and the permission trigger collapses to the 28px selector-fill icon circle the attach controls wear (label and chevron hidden; the mode name stays on the trigger's aria-label and the menu rows). The model chip keeps its text per the confirmed design. `data-composer-variant` on InputBar's root is the package-local contract that scopes both rules to the docked composer — the hero input card keeps the wrap and the labeled permission chip, and the desktop `(pointer: coarse)` label preservation is untouched because the handset rule outranks it only under the two data attributes.

## Alternatives considered

- **Center by widening the card to the transcript's inset instead of narrowing the transcript.** Rejected: the mock and the user both asked for one shared 16px column, and widening the card would fight the width axis the desktop rules derive from.
- **Fix the bias by removing `scrollbar-gutter: stable` or the scroller's 2px margin.** Rejected as the diagnosis: on classic-scrollbar hosts the right-side gutter does shift both boxes left of optical center, but the gutter reservation exists to keep the card from jumping when the bar appears (its own recorded decision), and on real handsets (overlay scrollbars) it reserves nothing — the inset split was the structural cause worth fixing.
- **Transition the drawer's exit without a delayed unmount** (e.g. keep the column mounted at `visibility: hidden` between uses). Rejected: a permanently mounted drawer keeps its focusable content in the tab order and its slots live; a bounded 300ms window confines the cost to the animation itself.
- **Drive the enter animation imperatively (WAAPI) instead of a keyframe.** Rejected: the keyframe needs no JS and no jsdom fallback, and `data-gesture-driven` already solves the only conflict (swipe-opened mounts), which an imperative path would also have to special-case.
- **Icon-only permission trigger via the existing `@container` or `(pointer: coarse)` rules.** Rejected: the container rule still shows the chevron and the coarse rule deliberately preserves the label on desktop touchscreens; the user's directive is exactly the overlay band, so the two-attribute selector states that scope instead of redefining either existing rule.

## Consequences

- The handset conversation column is symmetric and aligned at 16px; the desktop width axis (shared rule, width handles, `--dsh-chat-user-width`) is bit-identical.
- Every drawer open/close path animates on one duration and curve; the unit spec pins the closing window, the reopen cancel, the band exit, and the swipe integration, and the mobile-drawer e2e pins the keyframe name and the slide-out end transform in a real browser.
- The composer row is one line at 390px with the permission mode one tap away as an icon; the hero card and desktop touch behavior are unchanged.
- `data-sidebar-fab` now has three consuming packages (ui-layout publishes; ui-conversation and ui-chat consume); the contract is recorded in comments on every side and pinned by style-contract specs.
