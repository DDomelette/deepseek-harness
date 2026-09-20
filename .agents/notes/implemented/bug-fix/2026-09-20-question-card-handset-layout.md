# Agent Note: Question card handset layout

Status: implemented

English | [中文](2026-09-20-question-card-handset-layout.zh.md)

## Problem

Measured on a 360×740 viewport, the Web question card (`packages/client/ui-user-questions`) was unusable on narrow handsets in three ways:

- The card's `max-width: var(--dsh-chat-content-width)` follows the reading-length axis, whose 64%-of-column term sized the card to 230px while the column offered 304px. The footer — pager (89px) plus skip/submit actions (154px) — overflowed that width by 47px, and the card's `overflow: hidden` clipped the submit button out of reach: a click at its center hit the card's frame, not the button. A 390px viewport barely fits the footer, which is why the defect stayed hidden.
- The pager rendered unconditionally, so a one-question request — the common case — showed a `1 / 1` position between two permanently disabled arrows, spending 89px of the footer's budget on dead chrome.
- The card caps at `min(60vh, 520px)`, and on a short viewport the option scroll region was left with ~354px: four options plus the custom-answer row showed only three options, and the custom entry disappeared into the scroll region with no scroll affordance a touch user can discover.

## Decision

Four changes across the two takeover cards (`QuestionComposer.tsx` and both CSS modules):

- The pager renders only when `questions.length > 1`. A single-question footer is feedback plus actions.
- Under the existing `max-width: 720px` media query, both cards (the question card and the plan-review card) take `max-width: 100%`, both takeover frames drop the desktop `clearance + 16px` side padding to the bare `--dsh-composer-side-clearance`, and both footers gain `flex-wrap: wrap` with an 8px row gap. The 16px inset exists to nest the takeover at input-card − 32 beside the transcript; on a handset the takeover replaces the input card outright, so it takes the input card's own gutter — the bare clearance, 16px per side. Desktop layout (>720px) is pixel-identical.
- The options variant's custom-answer row moves out of the `[data-question-scroll]` region into a pinned seat between the scroll region and the footer. The seat reproduces the row's in-list metrics (the 1px row gap as top margin, the list's 12px side padding, its 4px bottom inset) so nothing moves until the card caps and the list starts scrolling; from then on the row stays visible. The optionless question's block answer field remains scroll content — it is the whole body of its question. Both cards' height caps modernize from `60vh` to `60dvh`, matching the rest of the client.

## Alternatives considered

- **Shrink or restyle the footer to fit 230px (smaller buttons, icon-only actions).** Rejected: it redesigns chrome for a width the card should never have had — the card, not the footer, was the wrong size, and the reading-length axis is a transcript contract the takeover card has no reason to follow at handset widths.
- **Raise the 64% term or floor `--dsh-chat-content-width` on narrow columns.** Rejected: the axis is shared by the transcript and every dock card; retuning it to fix one card changes line length for the whole conversation.
- **Keep the input-card − 32 inset on handsets.** Rejected: below 720px the inset never comes from the width axis (its floor resolves to the column, so `max-width` never binds) — it comes only from the frame's padding, and it costs 32px of an already 230px card while the input card it nests inside is not even visible; matching the input card's gutter keeps one edge line for the seat's two occupants.
- **Keep the custom row in the scroll region and add a scroll hint.** Rejected: a hint does not make the entry reachable without scrolling, and the row is a peer of the footer actions (it carries the same submit-on-Enter flow), so pinning it next to them is the simpler contract.
- **Drop the footer wrap once the card takes the bare-clearance gutter.** Rejected: even at the wider handset width a ~320px viewport cannot hold pager plus actions for a multi-question request; wrapping is the only arrangement that keeps submit clickable without a second breakpoint.

## Consequences

- At 360×740 the question card measures 262px — the input card's own settled width at that viewport, up from 230px — the footer fits without wrapping, and submit is clickable; the custom-answer row is visible at every card height. The plan-review card takes the same width and its Approve/Refuse row stays hit-testable.
- Single-question requests lose the `1 / 1` pager in every viewport, including desktop — the recorded-session ARIA goldens that capture the composer (`snapshots/web/question-composer/ui.expected.md`, `composed.expected.md`, and `snapshots/web/steering/mid-steer.expected.md`) were refreshed for exactly this and the pinned row's exit from the radiogroup.
- A multi-question request on a sub-~320px viewport wraps the actions below the pager; the footer grows a row instead of clipping.
- The component spec pins the behavior: no pager for one question, the custom row outside the scroll region for the options variant, and the optionless block field still inside it. The composer's replay e2e (`apps/web/tests/question-composer.e2e.ts`) measures the settled 360×740 seat: the question card's width equals the input card's measured handset width, no pager, submit hit-testable at its own center, the custom row outside the scroll region and inside the card, and a plan review asked through the user-questions seam lays out at the same width with Approve hit-testable.
