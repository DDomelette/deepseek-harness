# Agent Note: Material detail head chrome and thread framing

Status: implemented

English | [中文](2026-09-22-notes-detail-rework.zh.md)

## Problem

A walkthrough of the material detail pane found four readability defects: the source strip was always open and competed with the body for attention; the action row mixed the status word with five buttons; a model answer quoting the body ("Markdown（专有名词，通常不译）" style) was indistinguishable from the material's own content; and the ask box floated mid-pane with the thread content loosely centered.

## Decision

The detail head now carries everything that is not the body: the material title, the status tag, a "查看详情" disclosure that folds the source record (label, view, locate entry) into a hairline card on demand, and one `⋯` menu holding the row-level actions — copy, archive (restore for an archived material), and delete. Delete goes through ui-primitives `RiskConfirmation` (acknowledge checkbox gating the confirm), replacing the one-click remove. The copy feedback no longer has a button to flip: it surfaces as a transient "已复制" note in the head. The template section's title copy is now 提示词 / Prompt.

The body section keeps only the body plus a draft's own lifecycle controls — save and analyze sit in a `bodyFoot` row under the editor, because they act on the body itself and are meaningless elsewhere. Analyze is the primary action for a draft, so it keeps the primary button look in the open rather than hiding in the menu.

The thread section stretches to fill what the pane leaves (`flex: 1; min-height: 0`): its rows scroll internally from the top, and the ask card pins to the bottom, restyled after the conversation composer (22px capsule, `--dsw-specific-input-major` fill, `--dsw-elevation-soft` with the hairline rebound to `--dsw-alias-border-l2`, send control inside). User rows stay `--dsw-specific-bubble` bubbles; assistant rows are flat prose with a localized 回答 / Answer role label above the text, so an answer quoting the body can never read as part of it. The ask input drops its own border and rides the card.

The walkthrough's leftover point — the detail title duplicating the body's first line — is deliberately left as-is: the title row and the body card are two presentations of the same text by design (one names the material, one is the record), and hiding the body's first line would mangle the record the pane exists to show.

## Alternatives considered

- **A floating popover for the source card.** Rejected: no ui-primitives click-popover exists (HoverCard is hover-only), and the folded card under the head answers the same need without clipping or positioning logic; the in-card locate button keeps its "cannot jump yet" hint inline.
- **All five actions into the menu.** Rejected for save and analyze: both are the draft body's own lifecycle and burying the draft's primary action behind a menu would cost the main flow more than the symmetry is worth.
- **Left accent bar instead of the role label.** Rejected: a 2px neutral border fights the hairline rule's neutral-border contract, and an explicit localized label is unambiguous across languages.

## Consequences

- `notes-detail.client.spec.tsx` follows the new chrome: disclosure toggling, menu flows for copy/archive/restore, the risk dialog's acknowledge/confirm and cancel paths, and the menu's outside-close; `MaterialDetail.tsx` stays at 100% coverage (433 package tests pass). A real-browser probe screenshotted the draft head, the open source card, the menu, the risk dialog, and the answered thread with its role label and bottom-pinned ask card.
- The `notes-refresh` golden's diff is exactly the head-chrome swap plus the answer role label.
- No protocol, store, or model-visible change: every command the new chrome calls already existed.
