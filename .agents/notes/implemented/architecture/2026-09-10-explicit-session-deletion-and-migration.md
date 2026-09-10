# Agent Note: Explicit Session deletion alongside historical migration

Status: implemented

English | [中文](2026-09-10-explicit-session-deletion-and-migration.zh.md)

## Problem

Permanent deletion must remove every stored generation so a later read cannot rediscover an older copy. Historical migration also accesses these files, but observation alone must preserve committed data.

## Decision

**Explicit deletion retains the shared writer lease while read-only migration preparation remains non-mutating.** The JSONL backend removes attachments and generations from oldest to newest, clears its decoded-log memo, and retains the POSIX lock file. Existing writers exclude deletion across backend instances. Read-only preparation publishes nothing; write opens validate the source revision and publish a successor under the same writer lease.

The [adjacent migration policy](2026-08-31-released-session-format-migrations.md) and [read-only preparation decision](2026-09-05-read-only-session-migration-preparation.md) continue to govern migration. They do not authorize retention cleanup; deletion requires an explicit request through the persistence deletion API.

## Alternatives considered

**Remove explicit deletion to preserve every historical artifact.** Rejected because permanent deletion is a required user operation. Migration preserves historical files; an explicit deletion removes the selected Session.

**Keep read-triggered publication and its write lease.** Rejected because observing a historical Session must not write a successor or compete for writer ownership.

## Consequences

Permanent deletion can coexist with lazy migration without making ordinary reads destructive. Writer contention rejects deletion instead of partially removing an active log. Empty POSIX lock directories remain, and deletion has no automatic retention schedule.
