# Agent Note: Notes settings card save timing and polish

Status: implemented

English | [中文](2026-09-21-notes-settings-card-polish.zh.md)

## Problem

A walkthrough of the notes settings card (`NotesSettingsCard.tsx`) found four defects: three save mental models in one dialog (the strategy choices wrote on click, the directory needed its own "save" button, the model route another), the read-only autoSend flag rendered as bare context-free text, two mojibake `鈥?` sequences in the DirectoryBrowser docblock, and a second copy of the hand-rolled button recipe that PR #60 converged everywhere except this card.

## Decision

One save model for the whole card, matching the host settings convention (DeepSeekModelsEditor commits text fields on blur): **a control saves the moment its value is decided**. The strategy choices already did; the model route and effort selects now write on change; the directory field commits on blur or Enter (free text never saves per keystroke), trims surrounding whitespace, and treats a blank-after-trim value as unset — the same write the removed button made. A directory picked through the native chooser or the in-card browser saves on the pick, because the pick is the decision. The feature editor is the one exception and keeps its explicit save: it writes a whole list entry minted from two fields, and the button now wears the primary variant so the commit point reads as one.

The autoSend flag is a quiet `Tag` beside the save control instead of bare text. The mojibake becomes em-dashes. Every remaining button in the card (strategy choices, browse, the browser's row actions, add-feature) renders as ui-primitives `Button` (`sm`; `outline`, with the pressed strategy and the feature save in `primary`), and the card's type moves onto the `--dsw-font-*` ladder; `settings.saveWorkspace` and `settings.saveModel` leave the dictionaries.

The toolLabel breakpoint question the walkthrough raised belongs to #56 (it aligns the label band to 559px there); this branch deliberately does not duplicate that change.

## Alternatives considered

- **Keep explicit save buttons everywhere.** Rejected: the host's own settings write on decision, and three models in one dialog was the defect; the feature editor's two-field mint is the only write that is not a single control's decision.
- **Validate the directory's existence before saving.** Rejected as scope: the Host's schema accepts any string and the in-card browser already proves existence for browsed paths; typed paths fail loudly the first time the Host cannot use them. Trimming is the only validation the card owns.
- **Auto-save the feature editor on blur.** Rejected: adding a feature mints its id at save time, so a blur-commit would create entries from half-typed fields; the primary-styled explicit save marks the commit point instead.

## Consequences

- `notes-settings.client.spec.tsx` moves to the new timing: blur/Enter commits, trim, unchanged-write suppression, immediate model/effort saves, pick/choose directory saves; `NotesSettingsCard.tsx` stays at 100% coverage (403 package tests pass).
- The walkthrough's breakpoint item is answered in #56; the `notes-refresh` e2e does not open the card and its golden is unchanged.
- No remote-protocol or model-visible change: the same patches reach `settingsUpdate`, only their timing moved.
