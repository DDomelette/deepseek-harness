# Agent Note: Single-pane settings on a handset

Status: implemented

English | [中文](2026-09-13-settings-single-pane-handset.zh.md)

## Problem

Phones reach the Web UI through [LAN Web serving](../architecture/2026-09-11-lan-web-serving.md), but the settings shell stayed a two-column panel: a 188px section rail beside a content column inside a fixed 800px panel. The panel's `max-width: calc(100vw - 48px)` shrank the whole surface to roughly 340px on a ~390px handset, leaving the content column about 150px wide — narrow enough that section copy wrapped to one character per line, so the Appearance, Language, and font-size controls were unusable.

## Decision

Below `SETTINGS_PANE_BREAKPOINT = 768` in `packages/client/ui-settings-general/src/client/pane.ts` the panel fills the viewport and shows one pane at a time: the section list first, then the chosen section alone. `SettingsPanel` publishes that choice as `data-pane` (`list` while no section is chosen, `detail` afterwards), and the stylesheet keys the pane switch, the merged top bar, and the 40px touch targets off the media query plus that attribute. In the detail pane the content header gains a back control with the section name beside it, so the two panes need no separate navigation; Escape returns to the list before it closes the dialog.

The pane switch is a media query over one published attribute rather than a viewport subscription: render code reads no live fact, and only the Escape handler reads the viewport width through `isSinglePaneViewport()`. The breakpoint matches ui-layout's `SIDEBAR_OVERLAY`; client feature packages share no runtime values, so this package keeps its own copy.

Inside the handset layout the nav and content columns stop generating boxes (`display: contents`), so their children become grid items of the panel: row one is a 60px bar carrying either the shell title or the back control and section name beside the shared close control, and row two carries whichever pane the choice selects. Each pane therefore keeps exactly one close control, in the top-right corner where the two-column panel already places it.

Coverage: `apps/web/tests/settings-mobile.e2e.ts` drives a 390×844 page — the list pane fills the handset with the section content off screen, a row tap opens that section's own pane with its name and back control, back returns to the list without closing the dialog, and nothing overflows sideways — then re-runs the same page at 1680px to pin the unchanged two-column layout, which offers no back control.

## Alternatives considered

- **A viewport subscription in the component.** Rejected: business components carry no subscription machinery, and which pane is showing is expressible in CSS from the published choice.
- **A second close control inside the list pane.** Rejected: the dialog would hold two controls with the same accessible name; merging both headers into one bar keeps one.
- **A nearly-fullscreen sheet with a tappable backdrop.** Rejected: section content needs the whole handset viewport, so the mask stays non-interactive behind a full-height panel.

## Consequences

- The two-column layout is untouched: every new rule sits inside `@media (max-width: 767px)` or keys off `data-pane`, and the desktop settings scenarios replay unchanged.
- Each pane scrolls on its own below the fixed top bar.
- Secondary surfaces outside the settings shell keep the desktop layout.
