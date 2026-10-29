---
description: "Configuration and behavior of session-deletion."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-deletion

English | [中文](README.zh.md)

## Summary

Recursive session-deletion orchestration for the DeepSeek Harness.



An optional detach callback receives the complete reserved plan before durable cleanup. API callers use it to release idle handles they own. New Sessions whose own id or parent belongs to an active plan are refused. Explicit deletion removes all JSONL generations; ordinary migration retains historical generations.

## Table of Contents

- [Service](#service)
- [Behavior](#behavior)
- [Errors](#errors)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="service"></a>
## Service

`ctx.sessionDeletion.delete({ sessionId, recursive })` permanently deletes one session and, when `recursive` is true, its descendant subagent sessions.

The service requires `storageDomain` and stores one `session_deletion` plan per root id.

<a id="behavior"></a>
## Behavior

- The full deletion plan is durable before the first destructive write.
- Retries load the plan instead of deriving lineage from the remaining logs.
- Attached cascade members refuse the whole deletion with `session-running`.
- Non-recursive deletion refuses when descendants exist with `session-has-descendants`.
- Deletion order is leaves-first so no dangling parent exists after a crash.
- Already-gone members are marked `missing` and still receive workspace cleanup.
- Each member transition persists before the next operation.
- The synchronous `session/created` listener rolls back creation of an active plan member or a new child of one; unrelated Sessions remain available.

<a id="errors"></a>
## Errors

| Error | Meaning |
| --- | --- |
| `session-not-found` | The target is neither live nor persisted and has no plan. |
| `session-running` | The target or a descendant is attached, or attached during deletion; details carry `runningSessionIds`. |
| `session-has-descendants` | Recursive deletion was not allowed. |

<a id="model-experience"></a>
## Model Experience

### Request context and condition

#### What the model sees

No model-facing surface from this package. The `ctx.sessionDeletion` service registers no tools, injects no prompts, and writes no session events.

#### Token effect

Zero direct tokens.

#### KV Cache effect

Independent of live requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The service never cancels running sessions; callers cancel first.
- Workspace cleanup is skipped only when no `workspaceRegistry` is mounted.

<a id="dev-note"></a>
### Dev Note

None.

No runtime invariant companion is published. The package validates inputs at registration or writes and exposes no second authoritative state to compare against an independent event stream.
