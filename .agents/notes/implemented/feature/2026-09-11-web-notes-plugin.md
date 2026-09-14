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

### Remote operations report refusals instead of throwing

The `notes` Remote namespace answers every call with the vocabulary in `src/types.ts`: `NotesSuccess<T>` for a value, `NotesRejected<E>` for a refusal whose `code` names the condition. A caller across the wire cannot see an exception type, and the panel has to explain a refusal beside the row that caused it, so each rule is exposed as a predicate on the service that owns it — `NoteSessions.hasWorkspace`, `NoteSessions.canArchive`, `Materials.isVisible` — and the method that enforces the rule reads that same predicate. `Analysis.analyse` and `Analysis.ask` return the failure they would otherwise throw, because reporting it is their caller's whole job. Enforcement therefore stays in the operation that makes the decision, and the browser never holds a rule the Host would not apply.

`materialUpdate` refuses a material that already entered its conversation (`material-submitted`): the session log carries the submitted body, and rewriting the recorded text would desync the row from its thread.

### The panel is a tab type that reads only through the Remote namespace

The browser half registers one page type with `ctx.sidebarRightTabs` — kind `notes` at the `builtin` band, recognizing no resource address — and draws it from the keyed `sidebar.right.pane.tab` seat under the definition's own `id`, so an extension may take the kind over without taking the body. A control in the conversation header's `conversation.session.header.corner` seat opens the tab by kind; `openTab` deduplicates a page within its pane, so pressing it again reveals the panel rather than adding a second one, and the control needs no state of its own.

The panel's Host access is `ctx.remote.notes` and nothing else: it never reaches a service, and it holds no rule the Host would not apply. Reads and the two writes it commands run in `src/client/face.ts`, which answers with the store the registration declares; the component only renders what that store holds and calls those commands, so a refusal is a state to draw rather than an exception to catch. Carrier failures, which name no notes condition, become one local `remote-unavailable` state carrying the transport's own message; a refused write reports beside the content it left standing, while only a failed read replaces that content.

The panel lays out two columns while its pane is wide enough and one below 560px, and the switch is a container query over the panel itself rather than the window — a right column's width is not the viewport's. Its editing follows the Host's rule instead of guessing: the wire summary carries `submitted`, derived from the material's recorded message ids, so the body is editable exactly while the material is a draft. The navigation bar's conversation chip lists every conversation including the archived ones, because a notes conversation is never deleted: picking one that is archived restores it, and the operations behind both choices already existed on the namespace.

Floating and docking are the right column's presentations, not the panel's: `ui-sidebar-right` already floats a tab into a panel and docks it back, with the floating window's own header. What the panel needs from that is knowing which presentation it is in, so `SidebarRightTabInfo.panel` carries `floating` — the one fact a tab's own presentation control cannot derive — and the control calls the frame's `float`/`dock` through the same face that opens the panel.

The settings card is the panel's second write surface, and it writes where the composition entry reads: `notes/settingsUpdate` merges into the notes section through `ctx.settings`, and a field the request names as null or omits is unset rather than stored as null, because the section's schema expresses an absent workspace or model override as an absent field. Clearing a field is therefore the same operation as returning it to the deployment default, and there is no second copy of the default in the browser.

### Collecting a passage needs a seat over the conversation

Nothing in the shipped Conversation seats covers its content: `conversation.session` declared only `conversation.view`. A bubble that collects what the reader selected has to sit over that content, so `conversation.session` gained one more child, `conversation.session.overlay` (`single`, session scope), rendered after the View inside the same element. It hands its occupant two facts — the View currently shown, and the element holding it — because a collecting surface needs both to say where a passage came from and to tell whether a selection belongs to this conversation at all.

The first consumer is `dsh-notes`, and its bubble registers the way any other extension does: `ctx.slots.inject('conversation.session.overlay', …)`. The alternative — covering the conversation from outside the slot system — would have put a floating layer's lifetime and authorization outside the mechanism that owns composition.

A collected passage records `sessionId`, the View, a localized label, and no message identity: the conversation's DOM does not mark which message a passage came from, and adding that mark would touch every message renderer for a feature whose "locate the source text" entry point is deferred. The bubble therefore appears only over the Views the notes vocabulary can name, and starts the first notes conversation when the deployment has none.

### A screenshot keeps the reference, not the bytes

`notes/materialAddImage` hands the encoded bytes to the deployment's attachment store and stores only what the store returns, so a material's record stays small, an image is stored once however many materials point at it, and the notes domain never becomes a second image store. A deployment with no attachment store reports `attachments-unavailable` rather than storing nothing silently.

Picking the image is the panel's own control, not a capture of the conversation: the browser reads the file as canonical base64 because that is the shape the attachment store takes over the wire, and a format or a read the browser cannot use is reported without asking the Host. Resolving a stored reference back into a model request is still open, which is why an image material is collected and listed but not yet answered.

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

The Host half carries the whole Remote namespace and the browser half reaches it, so a panel can list conversations and materials, edit a draft, submit it, read the answer back, and ask a follow-up without a rule of its own. What is missing is collection and layout: no surface in the transcript collects a selection, the archived bucket and drag reordering have no UI, and the record's attachment reference field has no writer, so there is no screenshot path and no `materialAddImage` operation.

A material's text and every model answer live in session events, so the plugin domain stays small and a material's content is never duplicated. That also means reading a material's answer requires the session log, and answering requires a live Session: a conversation whose process restarted reports `session-not-live` until it is reopened, because `ctx.agents` holds live Agents only.

A refused submission rolls its recorded message id back and marks the material `failed`. Without that rollback, `analyse` would read the material as already submitted and it could never be retried.

Ordering operations run one at a time behind a settled tail, so a burst of collections writes materials in call order at the cost of serializing them; the work each one does is a single table write, so the queue is not a throughput concern at panel scale.

Restoring an archived conversation returns it to its creation position rather than the top of the list, because `NoteSessionRecord` carries no order value; materials do restore to the top, through an explicit `order` value that `create` and `restore` both mint below every visible sibling.

## Testing

`packages/notes/notes/tests/` covers both halves at per-file 100% coverage: the domain over a real storage stack, material ordering and archiving, conversation records and the active pointer, conversation creation over the configured workspace and model (including joining a preset roster and disposing the agent when the record fails), thread attribution and projection, body composition, the settings section over a memory provider (including the unset semantics of a write), analysis orchestration against a stand-in agent registry, every Remote operation on its success and refusal path, and the browser half's registrations, commands, refusal lines, rendered list and detail, and settings card against a scripted Remote face.

`notes-composition.host.spec.ts` is the non-unit composition test `packages/AGENTS.md` requires for a product-visible plugin: it boots a test-owned `cordis.yml` through the real Loader and asserts that a bare `notes` row reaches active, that its schema defaults are what the row serves, and that unmounting the row frees the domain name. It waits on published services rather than on `loader.await()`, because a row's fiber settles before the services its `apply` mounts finish their asynchronous initialization. Its `agents` row is a sibling Loader row rather than a root-level provide, so the spec exercises the same resolution the shipped composition uses.

## Related

- [The notes design record](../../../../docs/superpowers/specs/2026-09-11-dsh-notes-design.md) — the feasibility findings, data model, and the four-phase change list.
- [The Phase 0-1 implementation plan](../../../../docs/superpowers/plans/2026-09-11-dsh-notes-host-core.md) — the task breakdown this phase follows.
