# @deepseek-ai/dsh-client-ui-session-reference

English | [中文](README.zh.md)

Web composer `@` source for workspace conversation snapshot references. It registers `InputTriggerSource{ trigger: '@', name: 'session', order: -1 }` over the warm `ctx.sessions.list` snapshot.

## Behavior

Candidates are sessions whose `cwd` equals the current session's `cwd`, excluding the current session, `blank: true` rows, and `origin: 'subagent'` rows. Query matching is a case-insensitive substring over `displayTitle` and session id; results keep host list order and cap at 50. Duplicate titles add `description: sessionId`.

Picking inserts a structured `ReferenceInsert` with `ref = sessionId`, `label = displayTitle`, and `clipboardText = @[label](dsh-session:<canonical-id>)`. The codec serializes the same canonical mention at submit, resolving the label from the current list row, then the pick-time label, then the session id. When the list is ready and the session is absent, serialization rejects and the input machine keeps the draft.

The browser encoder is a local UTF-8 base64url function; its output matches the host encoder byte for byte.

## Model Experience

### Canonical mention in the direct user message

#### What the model sees

The submitted direct message contains `@[label](dsh-session:<canonical-id>)` text before `@deepseek-ai/dsh-session-reference-admission` rewrites it; the snapshot itself is owned by that host plugin.

#### Token effect

The chip adds one canonical mention line to the direct user message; snapshot tokens are owned by the admission plugin.

#### KV Cache effect

Append-only: the mention rides the new user message and does not rewrite earlier history.

## Known Limitations and Deferred Work

- **Strict same-cwd candidates only** — cross-workspace handoff is out of scope.
- **Duplicate titles use the session id as description** — no richer disambiguation UI.
- **Labels can fall back to the session id** — when the session leaves the list between pick and submit and no pick-time label survives.
