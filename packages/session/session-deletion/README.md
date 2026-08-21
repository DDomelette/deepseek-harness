# @deepseek-ai/dsh-session-deletion

English | [中文](README.zh.md)

Recursive session-deletion orchestration for the DeepSeek Harness.

## Service

`ctx.sessionDeletion.delete({ sessionId, recursive })` permanently deletes one session and, when `recursive` is true, its descendant subagent sessions.

The service requires `storageDomain` and stores one `session_deletion` plan per root id.

## Behavior

- The full deletion plan is durable before the first destructive write.
- Retries load the plan instead of deriving lineage from the remaining logs.
- Attached cascade members refuse the whole deletion with `session-running`.
- Non-recursive deletion refuses when descendants exist with `session-has-descendants`.
- Deletion order is leaves-first so no dangling parent exists after a crash.
- Already-gone members are marked `missing` and still receive workspace cleanup.
- Each member transition persists before the next operation.
- A `session/created` for an active plan member rolls back the attach.

## Errors

| Error | Meaning |
| --- | --- |
| `session-not-found` | The target is neither live nor persisted and has no plan. |
| `session-running` | The target or a descendant is attached, or attached during deletion; details carry `runningSessionIds`. |
| `session-has-descendants` | Recursive deletion was not allowed. |

## Model Experience

### Request context and condition

#### What the model sees

No model-facing surface from this package. The `ctx.sessionDeletion` service registers no tools, injects no prompts, and writes no session events.

#### Token effect

Zero direct tokens.

#### KV Cache effect

Independent of live requests.

## Known Limitations and Deferred Work

- The service never cancels running sessions; callers cancel first.
- Workspace cleanup is skipped only when no `workspaceRegistry` is mounted.
