# Agent Note: Notes workspace picker UX — single-line browse, new folder, scrolling settings

Status: implemented

English | [中文](2026-09-23-notes-workspace-picker-ux.zh.md)

## Problem

Three defects in the notes workspace picker flow, all user-visible on first run: the gate's 选择目录 button wrapped its last character onto a second line; the in-card directory browser offered no way to create a folder, so a reader wanting a fresh notes directory had to leave the app to make one; and the settings card was clipped by the viewport with no way to scroll, stranding the fields below the fold.

## Decision

The browse button now carries `flex: none` and `white-space: nowrap`, so its label can never wrap regardless of the field's width pressure.

The directory browser gained a new-folder flow that needed no host change: the directory-picker capability already exposed `createDirectory` over the wire (`directory-picker/exists`, `directory-picker/create-failed`), so the notes face surfaces it as `createDirectory(path, name)` with a closed `{ ok: true, path } | { ok: false, code }` result. Creating a folder steps the browser into it, so choosing the fresh directory is one more click; refusals render inline under the name field rather than failing the pick.

The settings card mounts its `Modal` with a viewport-capped dialog (`max-height: calc(100vh - 48px)`, with a `100dvh` support) whose content scrolls, the same recipe `RiskConfirmation` already proved. The strategy choice became a two-seat row, the feature picker and its add control share one line, and sections separated by hairlines replace the card's former gaps — the card reads as one settings surface instead of stacked boxes.

## Alternatives considered

- **Widening the gate or shrinking the button label.** Rejected: the label is the correct copy in both locales, and any fixed width breaks again on the next translation; `nowrap` fixes the class of defect, not the instance.
- **Adding a notes-namespace `createDirectory` verb.** Rejected: the host's directory-picker wire already owns directory creation with closed refusal codes; a second verb would duplicate the seam and drift.
- **Letting the page scroll behind the modal.** Rejected: modal chrome belongs to the card, and a page-level scroll would strand the title and close control off-screen — exactly the report's symptom restated.

## Consequences

- `notes-settings.client.spec.tsx` gains a new-folder block: create-and-step-in, `exists` and generic refusals rendered inline, Enter-to-create with a busy reentry fence, and Escape collapsing the row (440 package tests pass).
- `fixtures.client.ts` mocks the seam's `createDirectory`; the panel's props and command wiring carry it through unchanged.
- Both READMEs' directory-field paragraph documents the new-folder control, its wire refusals, and the card's scrolling.
- `NotesSettingsCard.tsx` reads its dialog classes through module-level constants with a justified v8 ignore: the css module always defines the class, and the `?? ''` fallback exists only to satisfy the `Record` index signature under `noUncheckedIndexedAccess` — `RiskConfirmation.tsx`, the only other dynamic-class `Modal` caller, sits outside the coverage gate, so there was no in-gate precedent.
