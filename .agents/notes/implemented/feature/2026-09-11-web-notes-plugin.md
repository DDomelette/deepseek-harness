# Agent Note: The Web notes plugin keeps materials and answers each in its own conversation

Status: implemented

English | [中文](2026-09-11-web-notes-plugin.zh.md)

## Problem

A dsh session produces material a user wants to return to: a passage worth translating, a screenshot worth asking about. The harness had nowhere to keep it. Copying it into another session mixes it with unrelated work, and the Web surface offered no place to collect, list, or revisit a selection.

The feature also had two properties that had to be decided before any code: what a collected material is stored as, and which mechanism turns it into a model request.

## Decision

`@deepseek-ai/dsh-notes` is one tree package carrying both halves of a Web notes panel. The Host half owns a `notes` storage domain over `ctx.storageDomain`, the `notes` settings namespace, and one real dsh Session per notes conversation; the browser half owns the panel. Collected text and screenshots are stored as materials first and submitted to the model later.

### Notes question-and-answer runs through a real Session

Analysis and follow-ups call `Agent.followup()` on a real dsh Session. `docs/architecture.md` makes Model-visible ⟺ logged a runtime invariant: anything reaching a model request must be reconstructable from the session log. A bypass through `ctx.llm.stream` would need a new `SessionEventMap` event to satisfy that invariant, plus a Host RPC that turns browser bytes into an `ImageAttachmentRef`, plus hand-written stream forwarding and rendering. Routing through a Session gives the screenshot path, streaming, model and permission selection, and log compliance for free.

### Thread attribution records user-message ids

A material records the ids of every user message it submitted. Attribution resolves those ids to sequences and takes, for each, the events up to the next user message. A follow-up can arrive long after the first analysis and after other materials were analysed, so a contiguous range would attribute a neighbour's events to the wrong material.

Identity is matched rather than sequence because `Agent.followup(message)` returns `void`: the sequence a message lands on is not knowable at the call site, while `createUserMessage()` mints its id before the send. Recording a sequence would require racing the submission against `session/event`.

### Both strategies submit, and a follow-up uses the notes conversation

`strategy` selects when a material is submitted, not how: `manual` waits for an explicit analyse and `auto` submits on collection, and both paths call `followup()`. `agent.inject()` is not the "add only" implementation — it parks content in the inbox until the next message merges it into the same request, which would collapse several materials into one answer and break the one-row-one-answer rule.

Both entry points resolve the live Agent from the material's own conversation record (`Material.noteId` → the recorded dsh Session), never from `Material.source.sessionId`, which names the session the material was collected from. A follow-up that used the source session would post the question into an unrelated conversation.

### A concurrent analysis claims its material on the domain write chain

Analysis is idempotent, and the check that enforces it is the domain's atomic read-modify-write rather than a synchronous `get` before the send. Two callers can both observe an empty `messageIds`; only the one whose transform runs first records its id, and the loser sees that id in the returned record and submits nothing. A plain check-then-send would let a double click send the same material twice.

The operations that mint a material's order value (`create`, `restore`, `reorder`) are serialized behind one settled tail for the same reason. The order value comes from a synchronous read of the in-memory table, which a sibling write that has not landed yet does not reflect, so two concurrent creates would otherwise mint the same order and lose the newest-on-top rule. The tail settles on rejection, so a refused `reorder` does not stall the operations behind it.

### The last notes conversation cannot be archived

`ctx.notesSessions.archive` refuses to archive the last unarchived conversation. The panel always owns one conversation to show, and the browser half must not be the only thing enforcing that: the spec puts the rule on the archive action, and a direct caller would bypass a hidden button.

### A new conversation joins the deployment's default preset

`NoteSessions.create` starts a real dsh Session through `ctx.agents.create`, using the workspace and model from the settings section. The row that owns the agent registry may also mount a preset roster, and a Session created without joining one would be an empty world — no tools, no prompt sections — because the model-facing rows live per-preset in that deployment. The service therefore resolves `agentPresets` optionally and, when a roster exists, records its default id as `meta.agentPreset` and mounts it from the creation `setup` callback. Without a roster the model-facing rows stay on the host plane and the registry reads them from the global layer, which is what the headless bundle does.

The configured workspace is required: a conversation with no workspace has nowhere to run, so `create` rejects by name rather than picking one. The agent handle is not retained — the creation context is this service's fiber, so unmounting the plugin disposes every conversation it started; a failed record disposes the just-created agent instead of leaving it running without a record.

### One service opens the notes domain

`ctx.storageDomain.open` admits one open per domain name. `ctx.notesStore` is therefore the single owner: it opens the domain in its own `[Service.init]`, binds the close to its fiber's effect, and exposes the material and conversation tables plus the panel's active pointer. The material store, the conversation records, and the settings owner read those handles instead of opening a second domain.

### Thread attribution is tested as a pure function

`src/thread.ts` depends on nothing but the event shape it reads (`seq`, `type`, and `data.id`), so the attribution rule is pinned by hand-written event lists rather than by driving a live Session. The same shape reads a persisted log, so the rule survives a restart with no extra path.

## Dependency policy exceptions

The published dependency policy requires a dedicated heading for a reviewed safe-export classification. This change adds three exports to `SAFE_HOST_DEPENDENCY_EXPORTS` in `scripts/package-dependency-policy.ts`, all approved by the repository owner before the addition:

- `@deepseek-ai/dsh-llm#createUserMessage` — builds a frozen message from its input and a fresh `randomUUID()`, with no module-level state.
- `@deepseek-ai/dsh-storage-domain#defineDomain` — validates a spec's names, version, layout, and global schema, then returns it.
- `@deepseek-ai/dsh-storage-domain#domainTable` — returns `{ valueSchema }` from its argument.

The notes package declares `dsh.client`, so the policy inspects every runtime export its Host half imports. All three values are plain data construction, so a second installed copy yields values the first copy accepts.

## Alternatives considered

**Call `ctx.llm.stream` directly and render the stream in the panel.** Rejected: the Model-visible ⟺ logged invariant would require a new session event, and the screenshot path, attachment refs, streaming transport, and model selection would all need rebuilding. Routing through a Session reuses every one of them.

**Use `agent.inject()` for the "add only" strategy.** Rejected: `inject` merges parked content into the next admitted request, so two materials collected before any send would be answered together. The one-row-one-answer rule requires each material to occupy its own step.

**Record the sequence of each submitted message instead of its id.** Rejected: `followup()` returns `void`, so the sequence is only observable by racing `session/event` at submission time, and a restarted process cannot reconstruct which sequence a material's message landed on.

**Split the panel into a Host package plus a `packages/client/ui-notes` package.** Rejected for this phase: `packages/client/AGENTS.md` requires every `packages/client/*` package's node half to be empty `apply`, so a heavy Host half cannot live there, and splitting would add a cross-package Remote consumption path with no current consumer. The single dual-half package follows `packages/session-query/session-log-export`.

**Let each service open the notes domain.** Rejected: the facility admits one open per name, so the second `open` rejects with `already-open`. A shared owner also gives one close point, ordered after every consumer that injected it.

**Model the absent workspace and model override as `null` in the settings schema.** Rejected on the library's semantics: schemastery resolves a `null` default as "no default" (`Schema.resolve`), so a nullable field cannot carry `null` as its default. The schema leaves both absent, and the accessors report `null` to consumers.

**Give the model override a bare object schema.** Rejected: `s.object()` always defaults to `{}`, which then fails its own required fields, so an absent override could not be expressed. The schema wraps the object in a single-member union, which keeps the override skippable while still validating a present one.

## Consequences

The panel's browser half is a separate phase, and the Remote namespace that would carry it is not built, so the Host half has no browser consumer yet. The materials this phase stores are text only: the record carries an attachment reference field, but nothing writes an image into it.

A material's text and every model answer live in session events, so the plugin domain stays small and a material's content is never duplicated. That also means reading a material's answer requires the session log, and answering requires a live Session: a conversation whose process restarted rejects with a named error until it is reopened, because `ctx.agents` holds live Agents only.

A refused submission rolls its recorded message id back and marks the material `failed`. Without that rollback, `analyse` would read the material as already submitted and it could never be retried.

Ordering operations run one at a time behind a settled tail, so a burst of collections writes materials in call order at the cost of serializing them; the work each one does is a single table write, so the queue is not a throughput concern at panel scale.

Restoring an archived conversation returns it to its creation position rather than the top of the list, because `NoteSessionRecord` carries no order value; materials do restore to the top, through an explicit `order` value that `create` and `restore` both mint below every visible sibling.

## Testing

`packages/notes/notes/tests/` covers the Host half at per-file 100% coverage: the domain over a real storage stack, material ordering and archiving, conversation records and the active pointer, conversation creation over the configured workspace and model (including joining a preset roster and disposing the agent when the record fails), thread attribution, body composition, the settings section over a memory provider, and analysis orchestration against a stand-in agent registry.

`notes-composition.host.spec.ts` is the non-unit composition test `packages/AGENTS.md` requires for a product-visible plugin: it boots a test-owned `cordis.yml` through the real Loader and asserts that a bare `notes` row reaches active, that its schema defaults are what the row serves, and that unmounting the row frees the domain name. It waits on published services rather than on `loader.await()`, because a row's fiber settles before the services its `apply` mounts finish their asynchronous initialization. Its `agents` row is a sibling Loader row rather than a root-level provide, so the spec exercises the same resolution the shipped composition uses.

## Related

- [The notes design record](../../../../docs/superpowers/specs/2026-09-11-dsh-notes-design.md) — the feasibility findings, data model, and the four-phase change list.
- [The Phase 0-1 implementation plan](../../../../docs/superpowers/plans/2026-09-11-dsh-notes-host-core.md) — the task breakdown this phase follows.
