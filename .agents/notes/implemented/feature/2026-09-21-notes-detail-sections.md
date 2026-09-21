# Agent Note: Notes detail pane sectioning

Status: implemented

English | [中文](2026-09-21-notes-detail-sections.zh.md)

## Problem

One material's detail pane stacked its source strip, action template, body, status-and-actions row, and thread as undifferentiated flush-left text: no section titles, no container boundaries, the template's label set in an off-ladder 10px, and the status word baseline-mixed with the action buttons. Reading where the body ended and the answer began took effort the pane's job is to spare.

## Decision

The pane is now titled sections — Source, Action template, Material text, Conversation — each a small `--dsw-font-xxs-12` heading in `--dsw-alias-label-tertiary` over its content (`MaterialDetail.tsx`, `MaterialDetail.module.css`). One visual language throughout: flat sections with hairline (0.5px `--dsw-alias-border-l2`) containers where content needs a boundary; no elevation shadows anywhere in the pane.

- The action template card collapses to the prompt's first line (`line-clamp` under `aria-expanded="false"`) and the whole card is one button that expands it; the off-ladder 10px label is gone, and every size in the sheet rides the `--dsw-font-*` ladder.
- A submitted body sits on a hairline card; the draft editor keeps its own bordered box; a screenshot keeps its one-line placeholder.
- The status word is a quiet `Tag` on the left of the actions row, the buttons a right-aligned group.
- Thread rows follow the conversation's own convention (ui-chat `MessageItem`): the reader's rows are `--dsw-specific-bubble` bubbles at radius 22 with 10px 16px padding, the model's rows are flat prose.

The change is presentation-only: no `data-notes-*` hook, remote call, or model-visible data moved, and the refreshed ARIA golden (`apps/web/tests/expected/notes-refresh/settled.expected.md`) shows the only DOM-observable difference is the three section headings. New copy (`detail.section.source`, `detail.section.thread`, `detail.templateExpand`, `detail.templateCollapse`) ships in both dictionaries.

## Alternatives considered

- **Elevated cards (`--dsw-elevation-*`) per section.** Rejected: web-styling forbids mixing hairline borders with elevation shadows on one surface language, and the pane already lives on a raised layer-1 sheet — more elevation inside it reads as noise, not structure.
- **Collapsing the template by truncating the string.** Rejected: clipping text in the DOM would make the recorded prompt unsearchable and would break the existing assertion that the card carries the whole prompt; `line-clamp` folds visually while the text stays intact.
- **Numbered or icon-led section headers.** Rejected: the conversation, settings, and sidebar surfaces all use bare tertiary small headings; inventing a second header grammar for one pane breaks the product's visual grammar.

## Consequences

- The detail pane reads as four titled blocks at a glance; the template occupies one line until asked; status and actions no longer share a baseline.
- `notes-detail.client.spec.tsx` gains the collapse/expand behavior test; all 401 package tests pass and `MaterialDetail.tsx` keeps 100% coverage. Browser screenshots of the built app (collapsed and expanded) verified the sectioned layout end to end.
- The `notes-refresh` web e2e golden was refreshed for the intentional heading addition; replay passes.
