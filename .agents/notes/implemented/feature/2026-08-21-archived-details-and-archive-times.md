# Agent Note: Archived settings details dialog and archive timestamps

Status: implemented

English | [中文](2026-08-21-archived-details-and-archive-times.zh.md)

## Problem

The Archived settings page listed one bare title per archived conversation. Users could not tell when a conversation was archived, nor inspect its pre-archive context (workspace group, cwd, agent preset) without restoring it. Grouping by the pre-archive workspace already worked — [the archive-set note](2026-07-31-session-archive-global-set.md) keeps the archived session's `sessionIds` slot — but the archive instant itself was recorded nowhere.

## Decision

**A defaulted `archivedSessionAts` map rides the archive set through all four layers; the Archived page shows the date inline on every row and opens a fixed-field details dialog.**

- Durable: `workspaceDomainState.archivedSessionAts` — `z.record(sessionId, z.string()).default({})`, key-equal to `archivedSessionIds` (archive stamps `new Date().toISOString()`; unarchive and forgetSession delete the entry). This is the archive set's own additive-default precedent, so the domain version stays 2 and pre-field media parses to an empty map; sessions archived before the field existed carry no timestamp and the UI says so instead of fabricating one.
- Wire: `workspace.list`, both archive unary responses, and the `host/archived-sessions-changed` frame each pair the id set with the full map. The publisher's existing array comparison still detects every change because the map is key-equal to the set.
- Client runtime: `WorkspaceListState.archivedSessionAts` installs through the same three paths as the id set (list baseline, unary echo, changed frame).
- UI (`dsh-client-ui-settings-archived`): each row renders the archive date under its title (`row.archivedAt` over a `date.ymd` dictionary template — the message clock pattern, never `toLocaleString`, which would follow the browser language); an unknown-time placeholder covers pre-field archives. A details button (`IconInfoOutline16`, left of restore) opens a fixed-field dialog: group, directory, agent preset, archive time, last activity, status, subagent count, session id. `ArchivedRow` carries every summary field the dialog needs, so the dialog reads no store lookups and keeps no uncovered optional chains.

## Alternatives considered

**Replace `archivedSessionIds` with an array of `{ id, at }` entries.** Rejected: no schema default can upgrade pre-field media, and every consumer of the plain id array churns; the parallel defaulted map is the field's own precedent.

**User-configurable detail fields.** Rejected with the user: one fixed set covers the stated need; persisted display preferences would be new machinery without evidence of demand.

**Relative time for the row date (the activity-row pattern).** Rejected: an archive date is a lookup key ("which day did I shelve this"), where absolute dates scan better than "3 days ago".

## Consequences

The Archived page answers when/where a conversation was shelved without a restore round-trip. Old archives silently lack a timestamp (displayed as unknown) — acceptable, since no trustworthy value exists. The e2e scenario pins the inline date and the dialog through the assembled app; domain, wire-schema, runtime, and component suites each pin their own layer. Cross-layer field naming stays uniform (`archivedSessionAts`) so a grep reaches every hop.
