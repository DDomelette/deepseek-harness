# Agent Note: Modal Tab trap counts only rendered controls

Status: implemented

English | [中文](2026-10-19-modal-tab-trap-counts-rendered-controls.zh.md)

## Problem

`useModalLayer` owns Tab inside the foreground dialog: it collects the dialog's focusable controls in document order and wraps when the active control is the first or the last. The collection kept every match of the focusable query whose subtree carries neither `[inert]` nor `[hidden]`, and a control hidden with CSS carries neither attribute. The handset settings layout hides one pane at a time with `display: none` (`packages/client/ui-settings-general/src/client/SettingsRoot.module.css`, the `.panel[data-pane='list'] .options` and `.panel[data-pane='detail'] .navList` rules inside its `@media (max-width: 767px)` block), and `SettingsRoot.tsx` drives the settings dialog through `useModalLayer`. The last counted control therefore sat in the hidden pane, the wrap test never matched the last visible control, and Tab left the dialog onto the masked page; Shift+Tab left symmetrically. `Modal` and the settings shell are the trap's two consumers, so every dialog and the handset settings layout carried the defect.

## Decision

`packages/client/ui-primitives/src/useModalLayer.ts` keeps the focusable query and the `[inert]`/`[hidden]` filter, and adds `rendered(element)` to the Tab candidate filter. A candidate counts only when it and its ancestors render:

- `visibility: hidden` excludes the control itself, while an inner `visibility: visible` inside a hidden ancestor stays reachable, because the control resolves its own inherited value.
- `display: none` and `content-visibility: hidden` exclude the control and everything under an ancestor that declares them; neither hides in an overridable way, so the ancestor walk stops at the first declaration.

The predicate reads computed style rather than a layout box, and runs only on a Tab keydown in the foreground layer, so its cost follows the dialog's control count and depth instead of a frame loop.

The guard is "traps Tab on the last rendered control and skips CSS-hidden panes" in `packages/client/ui-primitives/tests/modal-layer.client.spec.tsx`: a headless `Modal` renders two visible controls after a `display: none` pane and a `content-visibility: hidden` pane, and the spec asserts that Tab from the last visible control lands on the first and Shift+Tab from the first lands on the last. Reverting the predicate fails that spec and leaves the file's other eleven tests passing.

## Alternatives considered

**Filter on `getClientRects().length > 0`.** This is the direct "no rendered box" test, rejected because jsdom has no layout engine: `getClientRects()` returns an empty list for every element there, so every candidate would be filtered out, each wrap would land on the dialog element itself, and the Tab assertions of `modal-layer.client.spec.tsx` would fail with no bearing on production CSS. Computed style is the same CSS authority and stays truthful in a DOM without layout.

**Use `Element.checkVisibility()`.** This is the platform answer in browsers, rejected because jsdom does not implement it, so the predicate would need a fallback branch the specs never exercise; the computed-style walk covers the same hiding mechanisms with one code path.

**Repair the handset stylesheet instead**, keeping the idle pane mounted without `display: none`. Rejected as the fix for this defect: the stylesheet expresses layout, a dialog must not trust its callers to hide content in a way the trap can observe, and any other caller that hides controls with CSS would still be miscounted.

**Annotate hidden panes with `hidden` or `inert`.** Rejected: it makes every caller mirror a layout decision into the DOM, and `inert` disables the subtree it marks rather than describing it.

## Consequences

- Tab and Shift+Tab wrap on the first and last control the page actually renders, so the handset settings dialog keeps focus inside its visible pane and every `Modal` inherits the correction.
- A control hidden by something other than these three declarations (`opacity: 0`, zero-size clipping, off-screen positioning) still counts. Those controls stay focusable, so counting them matches what Tab does in the browser.
- The predicate pays one `getComputedStyle` per candidate ancestor on a Tab press and nothing on other keys, renders, or frames.
