# Agent Note: Archived Session instants and recursive delete over Workspace and Session Remotes

Status: implemented

English | [中文](2026-10-17-archived-instant-and-recursive-delete.zh.md)

## Problem

Two fork features had no runtime surface after the upstream merge. The [archive-instant note](../feature/2026-08-21-archived-details-and-archive-times.md) describes a `archivedSessionAts` map that reaches the Archived settings page, and the [recursive deletion service](../../../../packages/session/session-deletion/README.md) describes a `ctx.sessionDeletion` orchestrator, but the merged tree shipped neither the Remote fields nor any mounted consumer: the registry kept the instant, the wire dropped it, and the deletion plugin loaded in no profile.

Both features cross the same three layers (durable registry → Remote → Archived settings page), so one record owns their realization on the merged architecture instead of two partial ones.

## Decision

**The Workspace Remote carries the archive instant beside the archive id, and the Session Remote owns `delete` as a thin mapping over the optional `ctx.sessionDeletion` service.**

- Workspace Remote: `WorkspaceBaseline`, the `archived` follow increment, and `WorkspaceArchiveValue` each add `archivedSessionAts`, key-equal to `archivedSessionIds`. `WorkspaceFeed` compares both the id list and the instant map, because unarchive followed by re-archive restamps an id without changing the set.
- Client: `WorkspaceSnapshot.archivedSessionAts` follows the baseline, the unary archive reply, and the streamed frame; `sameArchiveInstants` gates republication, so an unchanged map keeps the published snapshot reference while a re-stamp publishes a new one.
- Archived page: the row renders `Archived {date}` under its title from the dictionary's `date.ymd` template, and a Session archived before instants existed shows the unknown-time placeholder. The details dialog adds the archive instant to its fixed field list.
- Deletion: `session.delete({ sessionId, recursive })` returns `deletedSessionIds`. The method reads `ctx.get('sessionDeletion')` rather than injecting it, so a deployment without the service answers `session/deletion-unavailable` and every other Session verb keeps working. Closed service codes map to `session/running` (with `runningSessionIds`), `session/has-descendants`, and `session/not-found`; any other failure stays `gateway/internal`, so a storage fault never reads as a business refusal.
- Composition: `packages/bundle/web-app` mounts `session-deletion` next to `workspace`, where the registry the cleanup writes to already lives. A profile that omits both keeps no deletion surface.
- Client deletion: `sessions.deleteSession` sends `recursive: true`, then pulls the list baseline so removed rows leave every surface. The Archived page confirms first, disables both controls while the call is pending, and keeps the dialog open with the failure message when the Host refuses.

## Alternatives considered

**Timestamp the archive in the Client.** Rejected: two browsers would disagree about when a conversation was shelved, and a reconnect would lose the fact entirely. The instant must be durable with the archive set.

**Replace the id array with `{ id, at }` entries.** Rejected by the [earlier note](../feature/2026-08-21-archived-details-and-archive-times.md): no schema default upgrades pre-field media, and every consumer of the plain array churns.

**Mount the deletion service in the base bundle.** Rejected: `session_deletion` is durable state written only by an explicit user action, so profiles without a deletion surface should not open the domain. The Web bundle is the only current caller.

**Delete non-recursively and let the Client fan out.** Rejected: a partial failure would leave orphaned children whose parent is gone. The service derives one complete plan before the first destructive write; the Client sends one request.

## Consequences

The Archived page answers when a conversation was shelved and can remove a conversation with its subagent subtree, without inventing timestamps or leaving orphaned generations. Old archives keep the unknown-time placeholder, because no trustworthy value exists. Evidence: the Session Controller suite pins the error mapping, the Workspace Controller suites pin the instant propagation, the section spec pins the row date and the confirmation contract, and `apps/web/tests/archived-sessions-settings.e2e.ts` drives both features through the assembled application against the real Host.
