# @deepseek-ai/dsh-session-reference-admission

English | [中文](README.zh.md)

Host plugin that admits canonical `dsh-session:` mentions in direct user messages at `agent/pre-step`. It registers with `prepend: true`, delegates through `next()`, and rewrites only the downstream decision.

## Public API

- `name = 'session-reference-admission'`
- `inject = ['sessionReferenceResolver']`
- `apply(ctx)` registers the listener for the context lifetime; no config.

## Behavior

Each `decision.messages` entry with `role === 'user'` and `source.kind === 'user'` is scanned with `parseSessionReferenceText()` block by block. Non-text blocks pass through unchanged. For a message with references, `ctx.sessionReferenceResolver.prepare()` reads and projects the sources; the direct message is replaced with `freezeMessage({ ...message, content: prepared.content })`, preserving id and source, and `prepared.additionalContext` is inserted immediately before it.

No references means the original decision object is returned unchanged. A malformed explicit mention, a failed source read, or a budget/limit error is thrown from the listener, so the agent loop records `turn/end{reason:'error'}` and never sends partial context.

## Model Experience

### Referenced-session snapshot ordering

#### What the model sees

For a message that mentions another session, the step contains the `session-reference` snapshot message followed by the readable direct message. The snapshot text is owned by `@deepseek-ai/dsh-session-reference`.

#### Token effect

Conditional and append-only: referenced sessions add one bounded snapshot message per accepted direct message; messages without references add nothing.

#### KV Cache effect

The replacement suffix begins at the snapshot message; earlier request history stays append-only.

## Known Limitations and Deferred Work

- **Pre-step failure discards the claimed direct message** — the browser half revalidates picked sessions before submit, but a race after that check surfaces as a turn-error card, not an RPC-level prompt error.
- **Other pre-step listeners see the raw canonical mention text** — they run before this outermost listener rewrites it; no current listener depends on that text.
