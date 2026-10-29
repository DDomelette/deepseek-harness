# Agent Note: Loading a recorded notes conversation again

Status: implemented

English | [中文](2026-10-10-notes-conversation-reload.zh.md)

## Problem

A notes conversation is a durable record plus a real dsh Session, but `Analysis.targetFor` resolved its Agent through `ctx.agents.get`, which holds live Agents only. A `dsh web` process that restarted therefore left every recorded conversation without an Agent: `analyse` and `ask` reported `session-not-live`, a submitted material's thread read reported the same, and the panel's only advice was that the conversation had to be reopened — an act the panel itself could not perform. A draft's thread read failed identically, so a material that had never entered its conversation showed a conversation-liveness error where "not submitted to the model yet" belonged.

Measured on the reporting deployment: the active notes record named Session `cd1079a4-ecf1-453c-8813-bca536124e7b`, written 2026-09-16, while the serving `dsh web` process had started 2026-10-10. The Session log was intact, the record was listed, and 分析 on a material collected that day could submit nothing.

## Decision

A recorded conversation is loaded on demand. `NoteSessions.liveAgent(record)` returns `ctx.agents.get(record.sessionId)` when this process holds the Agent, and otherwise loads the recorded Session again through `ctx.agents.resume`. The load is composed by the same private `composition()` that `create` uses — the deployment's preset roster when it has one, and the notes section's model route or the deployment default — so a conversation loaded again runs on what a conversation created now would run on. The loaded Agent is owned by the notes service's fiber exactly like a created one, so an unmount disposes it.

Loads are single-flight per Session. A Session's persistence admits one writer, so a second concurrent load would be refused rather than served; callers that arrive together share the first one's promise. The entry leaves the map when its load settles, so a failure is never remembered as an answer and the next call retries.

A load that cannot happen is reported rather than thrown. `Analysis.targetFor` stays the one place that turns a conversation into an Agent, and it answers `session-not-live` when `liveAgent` yields nothing; the reason — a log that is gone or unreadable, a deployment that mounts no session persistence, a write lease another process holds, or a preset roster that cannot compose — is logged for the operator. The panel's line for that code is now 「这个笔记会话无法恢复运行，请新建一个会话继续。」, because the reader is no longer the one who has to reopen it.

`Analysis.thread` answers a material that never entered its conversation with no rows *before* it resolves any Agent: a draft has nothing to read, and a conversation that received nothing is not started to say so. Both `thread` and `NotesRemote.materialThread` are async for the submitted case, which resolves — and may load — its conversation first. `Analysis` no longer injects `agents`, which it now reaches through `ctx.notesSessions`.

## Alternatives considered

- **Reopen the Session through the API session controller.** Rejected: that controller is the Remote BFF, and a product plugin reaching up into it would invert the layering; the notes plugin created these Sessions and already owns their composition, so loading one again belongs beside `create`.
- **Keep the refusal and add a control that opens the Session in the session list.** Rejected: the Host already knows how to load a recorded Session, and the detour would leave the panel's own operations failing until the reader takes it — while still reporting `session-not-live` for a conversation the Host had not tried to load.
- **Read a submitted material's thread from persistence without an Agent.** Rejected: it needs a second read path (`ctx.sessionQuery`) beside the live-log projection, and `analyse` and `ask` would still have to load the conversation; one resolution point keeps what the panel shows equal to what the model saw.
- **Claim the material before resolving its conversation.** This would preserve the previous ordering between an edit and an analysis issued in the same tick, but it would mark a material `analyzing` for a conversation that may not be loadable at all, and rolling that claim back would report a conversation failure through the send's own vocabulary.
- **Hold the resumed `AgentHandle` and dispose conversations on idle.** Rejected as unneeded: only the conversations a reader actually opens are loaded, and the service's fiber already owns them through the resume context.

## Consequences

- `tests/conversation-resume.host.spec.ts` pins the load itself: a live Agent is returned without one, a recorded Session is loaded again with the Session id its record names, a loaded conversation is composed like a created one (model route and preset mount), one load serves callers that arrive together, a load that fails reports nothing, and a failed load is retried.
- `tests/analysis.host.spec.ts` analyses, asks, and reads the thread of a conversation this process does not hold, and its former not-live cases now script a failing load; `tests/remote.host.spec.ts` covers the same path over the wire namespace; `tests/notes-composition.host.spec.ts` — the real Loader composition this package requires — analyses a material whose conversation the process does not hold.
- `tests/submission-races.host.spec.ts` records the ordering change: a same-tick analysis no longer reaches the material's write queue before a sibling edit, because it resolves its conversation first. An edit that lands in that window supplies the submitted body, an analysis that already claimed its material refuses a later edit, and an edit whose own write loses that race is refused with `material-submitted`.
- The package README (both languages) drops the "a notes conversation must be live" limitation for "a conversation whose Session cannot be loaded is refused", documents the load in *What to expect* and *Submission*, and the two dictionaries carry the new refusal line.
- No recorded-session scenario is added: loading a conversation again changes no model-visible transcript, and the panel's coverage stays in this package's own Host and client suites.
- [The notes plugin note](../feature/2026-09-11-web-notes-plugin.md) claimed a restarted process reports `session-not-live` until the conversation is reopened; that fact is corrected there, and the note points here for the loading decision.
