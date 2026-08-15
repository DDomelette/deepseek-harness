# @deepseek-ai/dsh-session-deletion

English | [中文](README.zh.md)

Recursive session-deletion orchestration for the DeepSeek Harness.

## Service

`ctx.sessionDeletion.delete({ sessionId, recursive })` permanently deletes one session and, when `recursive` is true, its descendant subagent sessions.

## Behavior

- Attached cascade members refuse the whole deletion with `session-running`.
- Non-recursive deletion refuses when descendants exist with `session-has-descendants`.
- Deletion order is leaves-first so no dangling parent exists after a crash.
- Already-gone cascade members are skipped for idempotent resumption.
- After each durable delete, an optional `workspaceRegistry` receives `forgetSession(id)`.

## Errors

| Error | Meaning |
| --- | --- |
| `session-not-found` | The target is neither live nor persisted. |
| `session-running` | The target or a descendant is attached; details carry `runningSessionIds`. |
| `session-has-descendants` | Recursive deletion was not allowed. |

## Model Experience

The plugin registers no tools, injects no prompts, and writes no session events.

## Limitations

- The service never cancels running sessions; callers cancel first.
- Deletion cleanup depends on the workspace plugin being mounted when present.
