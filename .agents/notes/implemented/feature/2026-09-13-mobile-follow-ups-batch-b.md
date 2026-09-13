# Agent Note: Mobile follow-ups, batch B

Status: implemented

English | [中文](2026-09-13-mobile-follow-ups-batch-b.zh.md)

## Problem

The [handset layout](2026-09-13-mobile-responsive-batch-a.md) made the drawer, the settings sheet, and the conversation shell usable at phone width, but four gaps remained on that path. Every surface that closes itself on Escape and the frame's drawer each listened for the key independently, so one press tore down a whole stack at once: a lightbox over a conversation inside an open drawer closed all three. The four native `<select>` controls in the Settings surface — the provider select on the Models page, that page's model-catalog and protocol selects, and the plugin groups select — kept a desktop control height below the 44px minimum touch target. Three web e2e suites each carried their own private copy of the same wait-for-the-track-to-settle arithmetic, so the same concurrency reasoning lived in four places. And the two fixed overlays that cover the whole phone screen — the Modal and the settings sheet — sized their content to the raw viewport, which puts the card's gutter under a status bar in an installed PWA, under a landscape notch, and the sheet's top bar under those two bands with its scrolling pane under the home-indicator band.

## Decision

Escape has one ownership rule: the surface that closes itself on the key consumes it, and the frame drawer acts only on an Escape nobody consumed. `ui-primitives` Modal and Menu, `ui-layout` AppFrame, `ui-directory-picker-browse` DirectoryBrowser, `ui-attachment` ImageLightbox, `ui-goal` GoalBar, `ui-conversation` ContextMeter and QueueDock, `ui-chat` stat-dialog, `ui-settings-general` SettingsRoot, and `ui-workspace` WorkspaceBrowser all call `event.preventDefault()` when they handle Escape; `ui-model-selection` ModelSelect and `ui-subagent` SubagentHeaderLineage already consumed it. The drawer in `packages/client/ui-layout/src/client/AppFrame.tsx` — the lowest-priority owner, since it sits beneath every other surface — returns early on `event.defaultPrevented`, so the press that dismisses the topmost surface leaves the drawer open.

On coarse pointers the four `<select>` controls in the Settings surface carry a 44px minimum touch target (WCAG 2.5.5): one `@media (pointer: coarse) { … min-height: 44px }` rule for `select.input` in `packages/client/ui-settings-models/src/client/ModelsSection.module.css`, which matches all three Models selects, and one for `.groupSelect` in `packages/client/ui-settings-plugin-inventory/src/client/PluginGroupControls.module.css`. Every desktop declaration is unchanged.

`apps/web/tests/support.ts` exports `settleViewport(page, viewport, options?)` and `readSettledWidth(locator)` for the three web e2e suites that resize the window and measure conversation geometry. `settleViewport` applies the viewport, waits for the collapsed marker to reach the state that width is expected to show, then polls the conversation column's rendered width until three consecutive frames agree; `readSettledWidth` samples a locator's layout width until three consecutive readings agree. Both exist because crossing the sidebar breakpoint animates the frame's track and the composer card follows the transient column, so a single sample can catch a mid-animation overlap the resting layout never has. No behavior changed: `composer-tab-geometry.e2e.ts`, `plan-control-row.e2e.ts`, and `sidebar-right.e2e.ts` call the shared helpers at the same 34 call sites.

The two fixed overlays that cover the phone screen take the safe-area insets as their own spacing. `packages/client/ui-primitives/src/Modal.module.css` pads its fixed layer with `max(24px, env(safe-area-inset-*))` on all four sides, so the card's 24px gutter widens to the inset wherever the device reserves more, and its mask becomes `position: fixed` so it still covers the bands the padding keeps the card out of. `packages/client/ui-settings-general/src/client/SettingsRoot.module.css` gives the handset sheet `padding: env(safe-area-inset-*)` under `box-sizing: border-box`, so the top bar clears an installed PWA's status bar and the scrolling pane stops above the home indicator. A device that reports zero insets renders both exactly as a desktop viewport does.

## Alternatives considered

- **A shared overlay-stack registry for Escape ownership.** Rejected: every overlay would register and unregister with a stack, and the registry would need its own ordering rules, teardown discipline, and tests to reproduce what the browser already tracks. `event.defaultPrevented` carries the same "some surface already handled this" fact out of the native event, with no state to keep in sync with the DOM.
- **Pad every fixed overlay with the safe-area insets.** Rejected: a blanket rule changes dialogs that already fit inside the safe area on a desktop viewport, and moves the decision away from the surfaces that actually meet a device band. The phone-screen surfaces each own how they spend the inset — the Modal as a gutter, the sheet as padding — which leaves every other overlay's spacing alone.

## Consequences

- Escape ownership is opt-in per handler. A new overlay that closes on Escape without consuming the key lets the press through to the drawer, which then closes on the same press — the failure this rule removes. The cost is that the rule is stated in a comment at each consuming handler rather than enforced by a shared mechanism.
- The 44px minimum applies only under `(pointer: coarse)`, so the coarse-pointer declaration raises the settings control height while keyboard and fine-pointer users keep the denser desktop density.
- The shared settle helpers add a wait to each call they replace, bounded by the poll's five-second deadline; the payoff is one copy of the track-transition reasoning instead of four.
- The safe-area padding resolves to zero where no inset exists, so a desktop viewport renders the Modal and the settings sheet unchanged and the mobile lane's zero-inset case pins that behavior.
- iOS safe-area and keyboard behavior is still not verifiable in CI; it remains an accepted gap covered by manual device checks, as the batch A note records.
