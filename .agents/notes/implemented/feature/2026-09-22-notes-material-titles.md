# Agent Note: Material titles and row tail menu

Status: implemented

English | [中文](2026-09-22-notes-material-titles.zh.md)

## Problem

A material row's title was its collection source label (e.g. "对话中的选区"), so every row in a conversation read the same, and the trailing source tag ("对话") repeated what the row no longer needed to say. The reader could not name a material, and the row's only action was archive.

## Decision

A material carries an optional reader-set `title` (`materialRecord` in `domain.ts`): the field defaults to `null` in the record schema, so documents written before it existed still parse — the notes domain's single-document layout rejects a version-stamp mismatch at open and has no compat ladder, so the field ships **without** bumping `NOTES_DOMAIN_VERSION`, recorded in the version's docblock. The host gains `Materials.rename(id, title | null)` and the remote endpoint `materialRename`; the title is presentation metadata, so a submitted material accepts a rename (unlike its body, which the session log owns). A blank title trims to null, returning the material to its derived title.

Client-side, `materialTitle()` (`src/client/title.ts`) resolves what a row and the detail head show: the stored title, else the body's first non-blank line trimmed and capped at 40 grapheme clusters (`Intl.Segmenter`, so the cap never splits an emoji) with an ellipsis, else the source label for a textless screenshot. The row's trailing source tag is gone; the row's tail now seats two controls — the archive button and a `⋯` menu — in the same in-flow visibility seats the archive handle established, revealed on row hover or focus-within. The menu (ui-primitives `Menu`, portaled so the list column's scroll container cannot clip it) opens a rename dialog built from ui-primitives `Modal`, `Input`, and `Button` — the same shape as the workspace's session rename modal, IME composition included. A blank draft disables saving; there is no separate "reset" entry, since clearing back to the derived title is the blank-title write the dialog rejects — re-adding it is a follow-up if readers ask. The detail pane's head (`data-notes-material-title`) shows the same title, while the source section keeps the collection's own label.

## Alternatives considered

- **Bump `NOTES_DOMAIN_VERSION` to 3.** Rejected: the single-document layout has no `compatibleVersions` path (that ladder exists only for per-record units), so a bump would lock every existing notes unit out with `version-mismatch`. The additive defaulted field keeps old documents readable and old binaries forward-tolerant (zod strips the unknown key).
- **Inline rename in the row.** Rejected: the product's rename idiom is a modal with a focused, selected input and IME-safe Enter (the workspace browser's session rename); a second idiom inside the list would drift.
- **Derive titles on the Host.** Rejected: derivation is pure presentation over data the listing already carries, and the web layer owns presentation; storing a derived copy would also freeze it against body edits.

## Consequences

- Rows read as titles instead of repeated source labels; renaming persists across restarts; the archived bucket and its restore row are unchanged.
- Coverage: `title.ts` unit tests (first-line, trim, 40-grapheme cap, fallbacks), row menu/dialog flows (Enter, IME composition, blank-disabled, cancel, outside-close), host rename (trim, blank-clears, submitted material, unknown id), and a domain test proving a pre-title record parses. The `notes-refresh` web golden shows exactly the row-title/heading change; a real-browser probe renamed a material end to end and found it in the Host's store.
- The source label still exists on the record and in the detail's source section; only the row stopped repeating it.
