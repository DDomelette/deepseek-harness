# Agent Note: Handset attachment badges vs the composer touch floor, and safe-area re-resolution after rotation

Status: implemented

English | [中文](2026-10-10-handset-attachment-badge-safearea-rotation.zh.md)

## Problem

Two handset-only defects surfaced on the paired phone against the two-row-header build ([Session header two rows](../feature/2026-10-09-handset-session-header-two-rows.md)). First, the image attachment thumbnail's remove badge rendered as a large dark circle that dominated the 64px thumbnail and read as misplaced ("不居中"); the badge's specified size is 18px, so something off-spec was inflating it. Second, after a landscape→portrait rotation the session header block shifted down by roughly the status-bar band and stayed there, while the floating brand button did not move; the offset persisted until reload.

## Decision

The inflation is the composer touch floor, not the badge. `InputBar.module.css` carries `@media (pointer: coarse) { .root button { min-height: 44px; min-width: 44px } }` (WCAG 2.5.5), and the `conversation.input.attachments` slot renders inside the card but outside `.row`, so the handset 28px exemption written for the docked row never reached it: on the phone the 18px badge became a 44px circle anchored `top: 4px; right: 4px` on a 64px thumbnail, which is the asymmetric, thumbnail-burying rendering the user circled. The same floor also inflated the file card's 18px remove badge, forced the failed-upload retry text button's 44px minimum to overflow the 64px card, and grew the rail's 24px paging arrows. ui-attachment now opts its badge chrome out under `(pointer: coarse)` with two-class selectors that outrank `.root button` (`.rail .remove`, `.card .remove`, `.root .arrow`), keeping the drawn sizes, and each badge carries a transparent `::after` hit zone (inset −13px on the 18px badges, −10px on the 24px arrows) so the 44px touch target survives without the visual inflation; the retry text restores its natural inline size. The floor rule itself is unchanged for InputBar's own controls and now comments the cross-package exemption.

The rotation shift is a stale safe-area inset. `packages/client/web/src/base.css` gives `#root` `padding-top: env(safe-area-inset-top)`, the only top-offset rule in the app, while the floating brand button is `position: fixed` and therefore immune to it — so a browser reporting an oversized top inset after rotation shifts exactly the in-flow chrome (the header) and leaves the button, matching the screenshot. Some Android WebView builds keep reporting a stale `env(safe-area-inset-top)` after a landscape→portrait rotation until a style change forces re-resolution. `installBrowserCompat()` (`packages/client/web/src/compat.ts`, the shell's browser-floor hook) now also subscribes to `orientationchange` and re-assigns one inline padding on `#root` with a reflow read in between, forcing the engine to re-read the whole declaration block; it re-runs on the next two animation frames and once more after a 400ms rotation-animation budget, and is a no-op when the engine already reports fresh values.

## Alternatives considered

- **Scope the floor away from the slot at its source (InputBar) instead of opting out per badge.** Rejected: the floor stays valuable for unknown slot content, and each badge with a specified drawn size opts out explicitly in the package that owns the design, keeping the exemption next to the size it protects.
- **Restore the drawn sizes without the transparent hit zones.** Rejected: it regresses the WCAG 2.5.5 target the floor exists for; the hit zone keeps both the drawn design and the 44px-class touch area.
- **Clamp the padding (`padding-top: min(env(safe-area-inset-top), Npx)`) against phantom insets.** Rejected for now: a cap must sit below genuine tall insets (an installed iPhone Web app reserves ~47–59px), so any number either clips real insets or tolerates a visible phantom offset; re-resolution fixes the caching class of the bug without a magic number. If device verification shows the affected engine persistently mis-reports rather than merely caches stale, the clamp returns as the documented fallback.
- **Listen to `visualViewport` resize instead of `orientationchange`.** Rejected for now: that event also fires for keyboard and toolbar geometry, adding pointless reflow toggles on every focus; `orientationchange` names the failing transition directly.

## Consequences

- `composer-touch-floor.client.spec.ts` pins the exemption selectors and the hit zones as CSS-source contracts, alongside the existing floor rule, so a floor specificity change cannot silently re-inflate the badges.
- `safe-area-resync.client.spec.ts` (jsdom) pins the orientationchange re-resolution on the frame passes and the delayed pass, the no-leftover-inline-style invariant, and the absent-root no-op.
- Device verification is pending on the paired phone: the remove badge measures 18px with a working tap, and the header stays put across a landscape→portrait rotation on the affected browser; the clamp alternative above is the fallback if re-resolution proves insufficient there.
- The [handset layout fixes](2026-10-08-handset-device-layout-fixes.md) statement that the 44px floor "still applies everywhere else on coarse pointers, including the hero card" is amended by this note: attachment chrome in the card opts out, everywhere else the floor stands.
