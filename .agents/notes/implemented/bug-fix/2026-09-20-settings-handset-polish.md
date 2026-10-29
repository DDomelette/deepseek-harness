# Agent Note: Settings detail pane handset polish

Status: implemented

English | [中文](2026-09-20-settings-handset-polish.zh.md)

## Problem

The [single-pane handset settings shell](../feature/2026-09-13-settings-single-pane-handset.md) put the settings panel on one breakpoint (`SETTINGS_PANE_BREAKPOINT = 768`, `data-pane="list|detail"`), but three detail-pane layouts were only measured on the desktop panel. At 390×844 touch emulation:

- The detail header held back + section title + the `Open configuration file` pill + close in one bar; the pill took about a third of the width and squeezed the section title against the back control.
- The Appearance preference's three full-width cubes (`flex: 1 1 180px` with wrap) stacked into a ~300px tower.
- The Permission row squeezed its title and description into a ~150px column beside the preset selector, wrapping the description a word a line.

## Decision

All three fixes live behind `@media (max-width: 767px)` in the owning stylesheets, keyed to the same breakpoint the shell publishes; the two-column layout is pixel-identical. The rows render only inside the settings panel, so the bare media query is the right gate (list pane never paints section content).

- `SettingsDocumentAction` keeps the action in the header for every section but collapses it to an icon-only button (`IconCodeOutline16`) in single-pane: the button now carries `aria-label={t('openDocument')}` and renders the label in a span the media query hides while revealing the glyph. The action opens the whole cordis.yml document, which is not General-specific, so it stays in the shared header rather than moving into one section's content.
- `AppearanceRow.module.css` turns the cube row into three compact equal segments (`flex: 1 1 0`, no wrap, 10px vertical padding, 12px radius, 13px label). The selected look and the `aria-pressed` semantics are untouched.
- `PermissionRow.module.css` wraps the row: text takes `flex: 1 1 100%` (the 48px selector reservation drops), and the selector moves to its own line, left-aligned. The font-size row shares the row shape but its stepper is small enough that the description is not squeezed, so it stays as it is.

## Alternatives considered

- **Move the open-document action into the General section as a content row.** Rejected: the action is registered on the root-scope `settings.action` list slot and shows in every section's header because the document it opens is global; parking it inside General would hide it from the other sections on handsets and would need a second slot registration for the same store.
- **Let the single-pane header wrap to two rows.** Rejected: the shell's grid gives the bar a fixed 60px row, and a taller bar costs every detail pane vertical space for one infrequent action; the icon-only treatment matches the rail and composer icon-button pattern already used elsewhere.
- **Fix the font-size row the same way as the Permission row.** Rejected as unneeded: its stepper control is ~80px, so the description column stays readable; changing it would be churn without a measured defect.

## Consequences

- At 390×844 the detail header fits one bar with the title readable, the Appearance choice takes one compact row, and the Permission description reads as full-width prose with the selector below it.
- Desktop (>767px) keeps every pixel: the icon seat is `display: none`, and both row stylesheets change only inside the media query.
- `apps/web/tests/settings-mobile.e2e.ts` measures the handset detail pane: icon-only document action with its accessible name, the three appearance cubes sharing one y, and the Permission selector below the description; the desktop test guards the labeled pill.
