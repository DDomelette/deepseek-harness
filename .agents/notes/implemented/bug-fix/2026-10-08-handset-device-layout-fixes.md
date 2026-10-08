# Agent Note: Handset device pass: gutter-free centering, compact composer row, bare trigger icons, drawer keyframe re-arm fix, drawer selection close

Status: implemented

English | [中文](2026-10-08-handset-device-layout-fixes.zh.md)

## Problem

A paired-phone pass over the batch-A handset surface ([Handset polish](../feature/2026-10-07-handset-conversation-polish.md), [Handset composer icons](../feature/2026-10-08-handset-composer-icons-dock-column.md)) surfaced five defects that desktop-viewport testing had not.

The conversation column still read left-shifted on the device, which shows a layout-consuming scrollbar: ConversationRoot's scrollport reserves `scrollbar-gutter: stable` plus a 2px right margin unconditionally, so the centered content column sits left of optical center by half the reserved width. The polish change had rejected touching the gutter on the reasoning that real handsets reserve nothing — true for overlay-scrollbar engines, false for the browser on the paired device.

The docked composer row overflowed its card: the `(pointer: coarse)` 44px minimum inflates every button in the row, and six 44px controls plus gaps cannot fit a ~358px card, so with `flex-wrap: nowrap` and the groups pinned at `flex: none` the send action rendered past the card's right edge, partially outside the viewport. The permission and model triggers' 28px selector-fill circles also read as clutter at that density; the user directed bare icons instead ("直接展示图标即可").

And a left close swipe on the open drawer twitched: the column flashed back toward the left edge before sliding out. The gesture band's suppression rule (`[data-sidebar-gesture] { animation: none }`) toggled the `animation` property off for the gesture and back on at release, which RESTARTS the `drawer-in` enter keyframe — a running keyframe overrides both the inline tracked position and the closing end state, and the exact visible sequence depends on where the restart's style recalc lands relative to the closing commit.

Picking a Session row also left the drawer open over the Conversation it had just selected. Session navigation returned the main slot to the Conversation but had no layout-facing drawer close, so the handset flow needed one more scrim tap or Escape after every pick.

## Decision

All rules stay scoped to the frame's `data-sidebar-fab` handset band (and `data-composer-variant='composer'` for the composer row); wide-screen and hero behavior is unchanged.

The scrollport drops the reservation in this band: `[data-sidebar-fab] .scrollBody { margin-right: 0; scrollbar-gutter: auto }`, and the overlay-composer seat's bar-width compensation drops with it (`right: 0`). On overlay-scrollbar engines nothing changes; on layout-consuming bars the centered column becomes symmetric again. The bar itself also hides in this band (`scrollbar-width: none` plus the WebKit `display: none` pseudo rule, the same pattern as ui-chat's TurnNavigator scroller): a visible bar on a layout-consuming engine would still narrow the column's content box from the right even without the gutter. The accepted residual: a sub-768px desktop window loses the transcript's scroll affordance with the bar — accepted because that window class is a resize transient, not a device.

The docked composer row restores drawn control sizes against the coarse floor: `[data-sidebar-fab] .root[data-composer-variant='composer'] .row button { min-width: 28px; min-height: 28px }` keeps the 28px icon triggers and the 34px send at their design sizes, so the row holds one line and the send action stays inside the card. The 44px WCAG floor still applies everywhere else on coarse pointers, including the hero card.

The permission and model triggers lose the selector-fill circle in this band: transparent background, `label-secondary` glyph, and a 16px icon in the 28px box (one step up from the circled 14px, keeping visual weight without the fill). Labels and chevrons stay hidden; names remain on aria-label/title and the menu rows. The attach controls keep their circles.

The drawer's enter keyframe becomes mount-scoped instead of suppression-gated: a new `data-entering` attribute arms `drawer-in`/`scrim-in` only on a fresh, non-gesture mount — a reopen inside the slide-out window transitions back from its mid-slide position instead — and the flag clears on the keyframe's own duration (a 300ms `DRAWER_SLIDE_MS` backstop, since `animationend` is unreliable when reduced motion drops the animation) or when a swipe engages. The gesture band now carries only `transition: none`; nothing toggles `animation` after mount, so no rule change can restart the keyframe. `data-gesture-driven` remains as the mount marker the unit spec pins, but its CSS rules are gone — gesture mounts simply never set `data-entering`.

Session navigation now owns the pick-and-dismiss sequence: `uiWorkspace.openSession` selects the Session, returns the main slot to the Conversation, then calls the new `layout.closeSidebarDrawer()`, and the no-Workspace New Session path does the same after clearing into its pure view. The layout store closes only `viewportWidth < SIDEBAR_OVERLAY && narrowExpanded`; squeeze-band and desktop sidebar preferences are untouched, and a superseded asynchronous open never reaches the close.

## Alternatives considered

- **Keep `scrollbar-gutter: stable` on handsets** (the polish note's stance). Superseded on new device evidence: the paired device's browser does reserve the gutter, so the reservation costs centering without buying the card stability it exists for; the card-jump concern is a classic-scrollbar desktop concern, and below 768px that residual is accepted.
- **Keep the 44px floor inside the docked row** (the composer-icons note's stance). Rejected on device: six inflated controls cannot fit the card, and the failure mode is worse than the small targets — the send action leaves the viewport. The floor remains the rule outside this one row.
- **Suppress mid-gesture with `animation-play-state: paused` instead of removing the `animation: none` toggle.** Rejected: a paused animation still applies its frozen keyframe value, which overrides the gesture's inline tracking exactly while the finger is down.
- **Clear the keyframe flag from `onAnimationEnd`.** Rejected: reduced motion drops the animation entirely, so the event never fires and the flag would stick; the duration backstop covers both paths.
- **Pass a `collapseSidebar` callback through the `sidebar.workspaces` owner share.** Rejected: dismissal is a navigation consequence, not a browsing-region rendering concern, and the layout store already owns the overlay-band facts needed to make it a no-op elsewhere.

## Consequences

- Real-browser verification at 390×844 with touch (keyless scaffold, seeded CJK transcript): the message column and the input card both measure symmetric 16px insets (`column`/`card` 16→374 at a 390px viewport), the row's buttons measure [28, 28, 28, 28, 34] with zero overflow, the send action's right edge lands inside the card, and a close swipe sampled mid-slide shows `animationName: none` with `translateX ≈ −195` — sliding out, never re-entering.
- The style-contract and navigation specs moved with the behavior: composer-handset-fab pins the bare permission icon and the compact floor, model-select-handset-fab pins the bare Models glyph, the app-frame spec pins the entering flag's arming, timeout clearing, swipe-engage clearing, and the reopen-in-window non-arming, and the layout/workspace service specs pin drawer-close scope and ordering after selection. The mobile-drawer e2e now picks a Session row and asserts the drawer closes, and pins the handset scroller's gutter-free, bar-hidden computed style; chat-scroll-contract's openSeed lets the result pick close the drawer on its own instead of racing a manual Collapse click against the slide-out unmount. That lane and composer-tab-geometry are green, while two chat-scroll-contract cases fail identically on the clean tree on this Windows host (host tool execution, unrelated to layout).
- This note supersedes two points in the owning notes: the polish note's gutter rejection and its `animation: none` gesture suppression, and the composer-icons note's selector-fill circle and in-row 44px floor. Both notes' shipped-fact sections point here.
