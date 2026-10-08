# Agent Note: Handset composer: icon-only model trigger, overlap fix, shared dock column

Status: implemented

English | [中文](2026-10-08-handset-composer-icons-dock-column.zh.md)

## Problem

Device verification of [Handset polish](2026-10-07-handset-conversation-polish.md) surfaced three more handset-only defects on the conversation page. The docked composer row overlapped: the permission trigger and the model chip's label rendered on top of each other and the attach button was squeezed out — the row's `flex-wrap: nowrap` let the `.tools`/`.modes` groups shrink, and a shrunken group lets its unshrunk content (the coarse pointer's 44px-minimum triggers) overflow into the next group. The user then directed the model trigger to drop its text as well ("将模型名字换成图标"). And the alignment story was incomplete: the goal dock (and the todo/queue docks sharing its inset convention) still sat at 100% − 64px while the messages and the input card already shared the 16px column, and the stats strip centered itself inside the desktop inset instead of aligning at the column edge.

## Decision

Everything keys off the frame's `data-sidebar-fab` attribute again, scoped to `data-composer-variant='composer'` for the trigger rules; wide-screen and hero behavior is untouched.

The overlap fix is structural, not a z-index patch: `[data-sidebar-fab] … .tools, … .modes { flex: none }` pins the group boxes so a trigger can never bleed into the next group; the row's single line then lies out honestly at 390px (probe: tools 24–180, trailing 256–356, no intersections).

The model trigger mirrors the permission trigger: under the two data attributes it collapses to the same icon-only 28px trigger (label, effort, and chevron hidden, `IconDataOutline16` shown), which deliberately overrides the coarse-pointer rule that preserves text on desktop touchscreens; the model name stays on the trigger's `title`/aria-label and the menu rows. A later device pass dropped the selector-fill circle from both triggers — bare icons read cleaner at handset density — and restored the row's drawn control sizes against the 44px coarse floor that overflowed the card: [Handset device pass](../bug-fix/2026-10-08-handset-device-layout-fixes.md). ui-conversation's InputBar comment records `data-composer-variant` as the contract ui-model-selection consumes across the slot boundary.

The goal, todo, and queue docks drop their extra `--dsh-composer-dock-inset` subtractions in this band and span the shared clearance-wide column, so every compositor surface (transcript, input card, docks) shares one left edge; the stats strip switches to `justify-content: flex-start` with zeroed side padding to sit at the same edge. The desktop inset convention (docks = card cap minus insets) is deliberately a non-handset rule, same as the transcript inset in the polish change.

## Alternatives considered

- **Fix the overlap by shrinking the triggers instead of pinning the groups.** Rejected: the 44px minimum is the accessibility target on coarse pointers; the layout bug was the group box lying about its content's width, not the target. A later device pass found six 44px controls cannot fit the card at all — the send action left the viewport — and restored the drawn sizes in this one row: [Handset device pass](../bug-fix/2026-10-08-handset-device-layout-fixes.md).
- **Keep the model label and only repair the overlap.** Rejected by the user: the text chip was the element that read as crowded, and the icon treatment keeps the row symmetric with the permission trigger; the name remains one tap away on the menu and on the trigger's accessible label.
- **Publish a shared `--dsh-composer-dock-width` custom property instead of per-module overrides.** Rejected: the three docks live in three packages with their own calc expressions today, and a new axis variable would add a fourth convention for two attribute-scoped rules per file.

## Consequences

- Real-browser probe at 390px: composer row renders +, attach, permission icon, model icon, send with no overlap; transcript, input card, and stats strip all measure x = 16 on the shared column.
- Contract specs pin every new rule: ui-conversation (group pinning, dock spans), ui-model-selection (icon circle), ui-goal (dock span), ui-chat (stats alignment).
- `data-sidebar-fab` gains two more consuming packages (ui-model-selection, ui-goal); the attribute remains the single cross-package handset contract, documented at every use site.
