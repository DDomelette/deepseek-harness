# Agent Note: Web session references through composer `@`

Status: implemented
Archived: 2026-08-21

English | [中文](2026-08-16-web-session-references.zh.md)

## Problem

The Web composer already had an `@` trigger pipeline, and the host already had `@deepseek-ai/dsh-session-reference` for bounded cross-session snapshots, but the Web profile exposed no way to select a workspace conversation and attach its snapshot to a message. Task handoff between conversations required manual copying or resuming the source.

## Decision

Two plugins connect the existing pieces. `@deepseek-ai/dsh-session-reference-admission` registers the outermost `agent/pre-step` listener and parses canonical `dsh-session:` mentions in direct user messages; it revalidates every source session's `cwd` against the current session through `ctx.sessionQuery.listSessions`, calls `ctx.sessionReferenceResolver.prepare`, replaces the direct message with readable `@label` text while preserving id and source, and inserts the snapshot message immediately before it. `@deepseek-ai/dsh-client-ui-session-reference` registers the `@` `session` input-trigger source over the warm `ctx.sessions.list`: same-cwd, non-blank, non-subagent conversations excluding the current session, cap 50, `order: -1`. Picking inserts a structured `ReferenceInsert` chip whose codec serializes the canonical mention.

Failures are fail-closed: malformed mentions, unreadable sources, and budget or limit errors throw from pre-step, so the turn ends with an error card and no partial context. The browser codec revalidates the picked session against a ready list before submit and keeps the draft on early failure.

The Web bundle mounts three rows: `session-reference`, `session-reference-admission`, and `ui-session-reference`. Apiproxy, the wire schema, the input state machine, and `InputTriggerCandidate` stay unchanged.

## Alternatives considered

- **Prepare inside the apiproxy prompt handler** — rejected because it would put Web-specific admission in the core gateway and duplicate the TUI pre-step path.
- **Extend the existing subagent `@` source** — rejected because plain title text cannot identify sessions uniquely and would bypass the canonical URI and snapshot trust boundary.
- **Browser plain-text mentions without chips** — rejected because the input machine's chip path already provides occurrence identity, labels, and codec serialization.

## Consequences

The snapshot remains send-time frozen, read-only, capped, and warned. Pre-step admission means other pre-step listeners observe the raw canonical mention text, and a late source deletion surfaces as a turn error rather than an RPC prompt error. Removing the three bundle rows removes the feature.
