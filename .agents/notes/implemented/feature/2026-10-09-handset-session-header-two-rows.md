# Agent Note: Handset Session header: two-row title layout

Status: implemented

English | [中文](2026-10-09-handset-session-header-two-rows.zh.md)

## Problem

Device use of the handset conversation page showed the Session header's single title row cannot hold its contents: the crumbs (`min-width: 0` + `overflow: hidden`) shrank to nothing beside the preset label, the background-job chip, the schedule catalog, and the utility/corner controls, so the session title — the row's primary information — was invisible exactly where navigation context matters most. The user directed the split, then refined it on the deployed build: the title alone fills a first row, and the preset (mode) name heads a second row with the background-session count and the remaining content.

## Decision

The split is pure CSS in the handset band (the frame's `data-sidebar-fab` attribute, the established cross-package handset contract of [Handset polish](2026-10-07-handset-conversation-polish.md)); wide-screen layout is bit-identical and no slot declaration, registration, or DOM structure changes. In `ConversationRoot.module.css` the `.titleCluster` and `.headerActions` boxes flatten to `display: contents`, making the crumbs and the action entries direct flex items of a wrapping `.titleRow`; explicit `order` values split them into two lines — crumbs 1 with `flex: 1` (the grow keeps the ellipsis working and lets the title span the row), a full-width `::after` break 2, and every action entry plus the utility/corner groups 3. Order ties resolve in DOM order and `::after` is the last child, so every line-two item carries an explicit order past the break; within line two the ties fall back to the actions slot's own order, so the preset label (order −10 at registration) heads the line with no per-entry marker. `.headerUtilities` keeps its box so `margin-left: auto` pins it and the corner group to line two's right edge. The header's 76px measure only aligns against the desktop sidebar; with no rail in the handset band the header grows to fit both rows. DOM order is unchanged, so screen-reader order stays the logical one.

## Alternatives considered

- **A dedicated `conversation.session.header.mode` slot, with ui-agent-preset re-registered into it.** Rejected: it changes the public SlotMap contract, the slots reference, the ui-schedule order fixtures, and every header test for what is a handset-only visual arrangement — and keeping the desktop "label beside the title" placement would still need the same flattening.
- **Render the actions slot twice with the `only` id filter** (once for the preset, once for the rest). Rejected: double-mounting entries duplicates their state and popovers, and hardcoding the `agent-preset` entry id in ui-conversation couples the packages worse than any stylesheet rule.
- **A `data-conversation-header-preset` attribute anchoring the label to line one's right edge** (the `data-sidebar-fab` cross-package pattern). Rejected on the user's placement directive: with the label heading line two, the actions slot's DOM order already puts it first, so the attribute was machinery without a job and shipped for only one iteration.
- **Wrap row two in a real container via a DOM restructure.** Rejected: any structural change lands on desktop too or forks the markup by breakpoint; the `::after` full-width break forces the wrap without a wrapper.

## Consequences

- At handset width the session title owns line one at full width and ellipsizes there; line two heads with the preset name, followed by the background-job chip, schedule catalog, utilities, and corner controls, with the utility/corner groups pinned right; the view tabs keep their own row below.
- Contract specs pin the arrangement: ui-conversation's `conversation-header-fab` spec asserts each rule against the stylesheet source (wrap, flattening, crumb order, break, line-two catch-all, utility pinning).
- Real-browser probe at 390px (keyless scaffold, seeded session recording the `minimal` preset): crumbs measure x 60→257 on line one, the "Minimal mode" label heads line two at x 60, and the utility and corner buttons pin line two's right edge.
- No new cross-package attribute contract: the split needs only the frame's existing `data-sidebar-fab`.

## Related

- [Handset polish](2026-10-07-handset-conversation-polish.md) — the `data-sidebar-fab` band contract and the shared content column.
- [Handset composer icons](2026-10-08-handset-composer-icons-dock-column.md) — the sibling handset-band arrangement for the composer row.
