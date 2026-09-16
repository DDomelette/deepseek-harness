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

### A submission settles with the turn that carried it

`Agent.followup()` returns void, so a submission has no result at its call site: the answer, or the failure, arrives with the turn that carries the message. `src/analysis.ts` subscribes to `session/event` and settles its materials on `turn/end`, and `src/turns.ts` answers the two questions that settle needs by reading that turn back out of the log — which user messages it carried, and whether the model answered. The log is the source rather than a table of open turns in memory, so a restored conversation settles by the same rule, and the reading stays structural like `src/thread.ts`.

Only a material still `analyzing` moves, and the write re-checks that inside the domain's own read-modify-write, so a settle that lost a race leaves the winning outcome alone. The turn must also have carried the material's **newest** recorded message: a question submitted while the first turn was still open appends its own id, and settling from the earlier turn would report that turn's outcome for a material whose answer is still coming while skipping the turn that actually carries it. A turn that completed makes the material `analyzed`; every other ending makes it `failed` with the reason the event carries — the failure's own message, or the ending's kind. A turn that never closed therefore leaves the material `analyzing`, which is the honest state: nothing in the log reports how it ended.

### A concurrent analysis claims its material on the domain write chain

Analysis is idempotent, and the check that enforces it is the domain's atomic read-modify-write rather than a synchronous `get` before the send. Two callers can both observe an empty `messageIds`; only the one whose transform runs first records its id, and the loser sees that id in the returned record and submits nothing. A plain check-then-send would let a double click send the same material twice.

The operations that mint a material's order value (`create`, `restore`, `reorder`) are serialized behind one settled tail for the same reason. The order value comes from a synchronous read of the in-memory table, which a sibling write that has not landed yet does not reflect, so two concurrent creates would otherwise mint the same order and lose the newest-on-top rule. The tail settles on rejection, so a refused `reorder` does not stall the operations behind it.

### The last notes conversation cannot be archived

`ctx.notesSessions.archive` refuses to archive the last unarchived conversation. The panel always owns one conversation to show, and the browser half must not be the only thing enforcing that: the spec puts the rule on the archive action, and a direct caller would bypass a hidden button.

### A new conversation joins the deployment's default preset

`NoteSessions.create` starts a real dsh Session through `ctx.agents.create`, using the workspace and model from the settings section. The conversation's route is the notes model override when the section carries one and the deployment's default model selection (`ctx.agentDefaultModel`) otherwise — the same default every other creating entry point reads — and it is passed as `agentOptions`, because an agent created without a route has none for its first request. The row that owns the agent registry may also mount a preset roster, and a Session created without joining one would be an empty world — no tools, no prompt sections — because the model-facing rows live per-preset in that deployment. The service therefore resolves `agentPresets` optionally and, when a roster exists, records its default id as `meta.agentPreset` and mounts it from the creation `setup` callback. Without a roster the model-facing rows stay on the host plane and the registry reads them from the global layer, which is what the headless bundle does.

The configured workspace is required: a conversation with no workspace has nowhere to run, so `create` rejects by name rather than picking one. The agent handle is not retained — the creation context is this service's fiber, so unmounting the plugin disposes every conversation it started; a failed record disposes the just-created agent instead of leaving it running without a record.

### The notes directory is a workspace, and each conversation is named

A session-list row carries the Session's own durable title and is grouped by the workspace that owns its `cwd`. A notes directory that nothing registered and no title left the notes conversations scattered through the reader's unrelated work under the ungrouped heading, each row labelled with the last segment of the directory path. `NoteSessions.create` therefore registers the configured directory through the optional `ctx.workspaceRegistry`, joins the new Session to that workspace, and titles the Session through the optional `ctx.sessionTitle`, before it records the conversation.

A workspace lists the Sessions it accounts for rather than every Session under its directory, so the record alone would still leave the conversation ungrouped; membership is a second call (`attachSession`) once the Session exists, because the registry validates the Session's stored header `cwd` against the directory.

Both are conveniences on optional services, and both are best-effort: the registry owns directories that exist, so registering a path that is not one fails, and an explicit title fails on a Session the title store does not hold live. The conversation the reader asked for is recorded either way, which is also what a deployment serving neither service does. `WorkspaceRegistry.create` returns an existing record without changing its title, so the plugin names only a workspace it created itself: renaming a directory the reader had already registered would move their other conversations under a name they did not choose.

The title is written as an explicit title, which pins the Session: automatic generation would otherwise retitle it from a message the reader types into the conversation later, and the panel's own conversation chip would stop matching the row. The number in `笔记 · NN` counts every record the domain holds, archived ones included, so a title is never minted twice.

### One store instance serves the panel and the bubble

The browser half registers two client entries over the same data — the right column's tab and the conversation's overlay — and each registration declares the store its component reads. They are one instance: `apply` builds it once and passes that handle to both registrations. Two instances hold two snapshots, so a passage collected through the bubble landed in the Host and stayed invisible in the panel until something re-read it there, which reaches the reader as a collection that did nothing. Both entries are views of one conversation's materials, so they read one state.

### One service opens the notes domain

`ctx.storageDomain.open` admits one open per domain name. `ctx.notesStore` is therefore the single owner: it opens the domain in its own `[Service.init]`, binds the close to its fiber's effect, and exposes the material and conversation tables plus the panel's active pointer. The material store, the conversation records, and the settings owner read those handles instead of opening a second domain.

### Remote operations report refusals instead of throwing

The `notes` Remote namespace answers every call with the vocabulary in `src/types.ts`: `NotesSuccess<T>` for a value, `NotesRejected<E>` for a refusal whose `code` names the condition. A caller across the wire cannot see an exception type, and the panel has to explain a refusal beside the row that caused it, so each rule is exposed as a predicate on the service that owns it — `NoteSessions.hasWorkspace`, `NoteSessions.canArchive`, `Materials.isVisible` — and the method that enforces the rule reads that same predicate. `Analysis.analyse` and `Analysis.ask` return the failure they would otherwise throw, because reporting it is their caller's whole job. Enforcement therefore stays in the operation that makes the decision, and the browser never holds a rule the Host would not apply.

`materialUpdate` refuses a material that already entered its conversation (`material-submitted`): the session log carries the submitted body, and rewriting the recorded text would desync the row from its thread. `materialAsk` refuses the opposite state (`material-not-submitted`): a draft has no thread, so the question would be reported as submitted while nothing left the process.

A send the inbox refuses is reported the same way (`submit-refused`, carrying the reason), after the recorded id is rolled back and the material is marked `failed`. Reporting it as a thrown error would leave the vocabulary and reach the panel as an unreachable Host rather than as a refused send. The two collection operations report the refusal their own auto-submission produced too, so a deployment that submits on collection never answers "stored" for a material that was refused.

### The Remote namespace declares the services it reaches

`NotesRemote` names every service it reads through `ctx.<name>` in its `static inject`. A declared injection resolves through the fiber's own dependency; an undeclared one is resolved by walking the accessing fiber's parent chain, and the loaded runtime throws `cannot get property "<name>" without inject` when that walk ends first — which reaches the panel as an unreachable Host rather than as a missing declaration. A hand-built context instead falls back to the global store, so the unit suite cannot see the omission: `tests/injections.host.spec.ts` pins the declaration for every plugin body in the package, host and browser halves alike, and `notes-composition.host.spec.ts` answers the namespace's operations through a real Loader composition.

### The panel is a tab type that reads only through the Remote namespace

The browser half registers one page type with `ctx.sidebarRightTabs` — kind `notes` at the `builtin` band, recognizing no resource address — and draws it from the keyed `sidebar.right.pane.tab` seat under the definition's own `id`, so an extension may take the kind over without taking the body. A control in the conversation header's `conversation.session.header.corner` seat opens the tab by kind; `openTab` deduplicates a page within its pane, so pressing it again reveals the panel rather than adding a second one, and the control needs no state of its own.

The panel's Host access is `ctx.remote.notes` and nothing else: it never reaches a service, and it holds no rule the Host would not apply. Reads and the two writes it commands run in `src/client/face.ts`, which answers with the store the registration declares; the component only renders what that store holds and calls those commands, so a refusal is a state to draw rather than an exception to catch. Carrier failures, which name no notes condition, become one local `remote-unavailable` state carrying the transport's own message; a refused write reports beside the content it left standing, while only a failed read replaces that content.

The panel lays out two columns while its pane is wide enough and one below 560px, and the switch is a container query over the panel itself rather than the window — a right column's width is not the viewport's. A second query at 500px drops the navigation controls' labels so a narrow pane keeps every control instead of losing the text ones. Its editing follows the Host's rule instead of guessing: the wire summary carries `submitted`, derived from the material's recorded message ids, so the body is editable exactly while the material is a draft and the follow-up box is drawn exactly once it is not. The row's action badge and the detail's template echo are the section's own words for the action the material names, so the panel reads the section when it opens rather than waiting for the settings card; an action the configuration dropped falls back to the stored id and echoes nothing. The navigation bar's conversation chip lists every conversation including the archived ones, because a notes conversation is never deleted: picking one that is archived restores it, and the operations behind both choices already existed on the namespace.

Floating and docking are the right column's presentations, not the panel's: `ui-sidebar-right` already floats a tab into a panel and docks it back, with the floating window's own header. What the panel needs from that is knowing which presentation it is in, so `SidebarRightTabInfo.panel` carries `floating` — the one fact a tab's own presentation control cannot derive — and the control calls the frame's `float`/`dock` through the same face that opens the panel.

The settings card is the panel's second write surface, and it writes where the composition entry reads: `notes/settingsUpdate` merges into the notes section through `ctx.settings`, and a field the request names as null or omits is unset rather than stored as null, because the section's schema expresses an absent workspace or model override as an absent field. Clearing a field is therefore the same operation as returning it to the deployment default, and there is no second copy of the default in the browser.

A collection action's label and prompt are edited in place and written as the complete list — the one place this card does not write a single field — because the list is one document value and an index-addressed path would drift as soon as it changes shape. The rule that a material can always resolve the action it names lives in the operation that decides: `NotesSettings.update` refuses a list whose action carries a blank id, label, or prompt, or two actions sharing an id, and reports `invalid-actions`. The card's disabled save is a courtesy, not the enforcement.

### The directory field offers the host's own chooser, and browses when there is none

The directory field names a directory, and typing a path is all a bare input can do. The host's own picking facility is already on the wire as the `directoryPicker` Remote namespace, so the card draws a chooser button beside the field rather than hand-rolling a browser directory dialog or importing the workspace plugin's browser half. `notesFace` receives that namespace as a narrowed face and answers a refusal the way the notes namespace does — as a failure the card draws, not an exception it catches.

`pick` is only half of that namespace. The adaptive composition resolves one interaction at boot, and a deployment bound to every interface, launched under SSH, or otherwise unable to reach the host display mounts the browse primitives instead, where `pick` is refused by design. The card therefore reads a refused `pick` as "browse here": it lists the host's home through `list` and draws that level, its child directories, and the controls to descend, step up, take the level, or leave it. The browser never joins path segments — a listing carries each entry's absolute path and the ancestry crumbs, so the card composes none of them itself. A cancelled chooser changes nothing, a level the host cannot read reports `directory-unavailable`, a panel-local code like the two image refusals because the Host never sees this call, and the field stays editable either way.

### The header corner holds more than one control

`conversation.session.header.corner` was a single seat, and `ui-sidebar-right` already keeps its panel-recall button there. A second registration into a single seat fails, and in the shipped composition that failure took the whole notes browser half with it: the plugin never activated, and the shell rendered without its frame at all. The seat is a list now and each occupant names itself with an id, so a session header's corner carries the recall button and a notes control at once.

### Collecting a passage needs a seat over the conversation

Nothing in the shipped Conversation seats covers its content: `conversation.session` declared only `conversation.view`. A bubble that collects what the reader selected has to sit over that content, so `conversation.session` gained one more child, `conversation.session.overlay` (`single`, session scope), rendered after the View inside the same element. It hands its occupant two facts — the View currently shown, and the element holding it — because a collecting surface needs both to say where a passage came from and to tell whether a selection belongs to this conversation at all.

The first consumer is `dsh-notes`, and its bubble registers the way any other extension does: `ctx.slots.inject('conversation.session.overlay', …)`. The alternative — covering the conversation from outside the slot system — would have put a floating layer's lifetime and authorization outside the mechanism that owns composition.

A collected passage records `sessionId`, the View, a localized label, and the identities of the row the selection started in: `data-chat-seq` and `data-chat-message-id` from the Chat seat, `data-chat-call-id` from a Tool wrapper inside that row, and `data-trajectory-seq` and `data-trajectory-call-id` from a Trajectory row. The Chat seat publishes its pair from the payload the row's Definition assembled — the event `seq` the row renders and, for a message row, its `messageId` — and publishes no `data-chat-seq` for a row assembled without a durable event, so the sort coordinate `anchorSeq` never becomes an identity: it orders rows and can be fractional. The bubble therefore appears only over the Views the notes vocabulary can name, and starts the first notes conversation when the deployment has none.

The identities ride the DOM contract that already carries `data-chat-anchor-key` for paging and selection rather than a second reader of the Chat node store: the right column sits outside the conversation slot tree, so nothing in it can reach the `useChat` snapshot that resolves a node key. A row that carries no identity degrades to the session and the View alone, which keeps a collection from failing over a row the projection assembled without an event of its own.

### The locate entry renders where there is a source to open

A material collected from a conversation row shows a `Locate ↗` entry in its source strip, and clicking it reports that this version cannot open the source yet. The entry is the finalized interface with its navigation half deferred: `IConversation` exposes `input`, `blocks`, `send`, `updateQueue`, `cancel`, and `loadOlder`, and the right column sits outside the conversation slot tree, so reaching the view navigator needs a product-side `openView(sessionId, view, focus)` that forwards to the existing `activateView` and the session store's `openView`. The entry renders only when the source records a sequence, a message, or a call: a material collected from the panel's own control has no row to point at, and an entry that could never open anything would misreport where the material came from.

The detail pane is keyed by material id, so its own state — an unsaved draft, the copy feedback, the locate report — belongs to the material it was made in. The list stays mounted beside an open detail, so without that key a draft typed for one material stayed in the pane, and the save that followed wrote it into the material the reader had switched to.

### A screenshot keeps the reference, not the bytes

`notes/materialAddImage` hands the encoded bytes to the deployment's attachment store and stores only what the store returns, so a material's record stays small, an image is stored once however many materials point at it, and the notes domain never becomes a second image store. A deployment with no attachment store reports `attachments-unavailable` rather than storing nothing silently.

Taking the image is the panel's own control, not a capture of the conversation: its picker and a paste anywhere inside the panel hand a file to one reader, `src/client/image.ts`, which produces canonical base64 because that is the shape the attachment store takes over the wire, and a format or a read the browser cannot use is reported without asking the Host. The paste listener sits on the panel rather than on the document, so a paste in the conversation's composer stays the attachment the model receives; a paste carrying no image keeps its own default behavior, and one paste collects one screenshot.

The material records the whole reference the store returned — the domain's version 2 record, and version 1 stored only the id — because the request part that names an image is `{ type: 'image', attachment }`: an id alone cannot say which media type, byte length, or dimensions the assembly and its normalization need. `src/compose.ts` therefore composes a screenshot as that image block, preceded by the action's template as a text block when the material was collected through one, and a text material as the single text block it always was. `src/thread.ts` keeps the row a screenshot submits: it carries no text, so the row also reports `hasImage` and the panel names the image beside whatever text it does have.

A submission that carries an image asks the LLM service what the conversation's route declares before it sends anything: `Analysis` reads `Agent.options`, resolves that route's model metadata, and reports `image-unsupported` when the route declares text-only input, so the panel asks for another model instead of the model reading a placeholder where the screenshot should be. Only a declared negative is a refusal — an agent whose options name no route, a deployment with no LLM service, and metadata that cannot be read are unknown rather than unsupported, and those submissions proceed to the request path that owns them. The image admission rule therefore reads the same way here as it does in the entry points that already refuse before prompting.

A screenshot's body is that reference, not text, so the detail pane names it where a text material shows its editor, and `materialUpdate` reports `material-not-text` rather than writing a body the request would never submit. The rule sits in the operation that would write, so a direct caller cannot store the shape the panel declines to offer.

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

The Host half carries the whole Remote namespace and the browser half reaches it, so a panel can list conversations and materials, edit a draft, submit it, read the answer back, and ask a follow-up without a rule of its own. Collection ships on both sides of the conversation: the selection bubble and the panel's own screenshot control write materials, and a collected passage carries the identities of the row it came from, which its source strip offers to locate. What is missing is the navigation itself — the locate entry reports the recorded source and explains that opening it waits on product-side view navigation — and a capture of the conversation itself, which neither the panel's picker nor its paste performs.

A material's text and every model answer live in session events, so the plugin domain stays small and a material's content is never duplicated. That also means reading a material's answer requires the session log, and answering requires a live Session: a conversation whose process restarted reports `session-not-live` until it is reopened, because `ctx.agents` holds live Agents only.

A refused submission rolls its recorded message id back and marks the material `failed`. Without that rollback, `analyse` would read the material as already submitted and it could never be retried.

Ordering operations run one at a time behind a settled tail, so a burst of collections writes materials in call order at the cost of serializing them; the work each one does is a single table write, so the queue is not a throughput concern at panel scale.

Restoring an archived conversation returns it to its creation position rather than the top of the list, because `NoteSessionRecord` carries no order value; materials do restore to the top, through an explicit `order` value that `create` and `restore` both mint below every visible sibling.

## Testing

`packages/notes/notes/tests/` covers both halves at per-file 100% coverage: the domain over a real storage stack, material ordering and archiving, conversation records and the active pointer, conversation creation over the configured workspace and model (including joining a preset roster, registering the directory as a workspace, joining the conversation to that workspace, titling the Session, and disposing the agent when the record fails), thread attribution and projection, body composition, the settings section over a memory provider (including the unset semantics of a write and a refused action list), analysis orchestration against a stand-in agent registry, every Remote operation on its success and refusal path, and the browser half's registrations (both entries over one store instance, which the bubble's collection test asserts), commands (including the chooser's chosen, cancelled, and refused answers and the browse levels it lists), refusal lines, the DOM anchor reader (including a row that carries no identity), rendered list and detail (including the locate entry and a draft that stays with its material), the pasted screenshot, the directory browser descending and stepping back up, and the settings card against a scripted Remote face.

The attributes that reader depends on are pinned where they are written: `packages/client/ui-chat` publishes a row's sequence and message from its payload and withholds the sequence from a row assembled without an event, and `packages/client/ui-trajectory` publishes a record's sequence and call. A renderer that stops writing one fails its own package's spec instead of silently leaving a material without its source.

`notes-composition.host.spec.ts` is the non-unit composition test `packages/AGENTS.md` requires for a product-visible plugin: it boots a test-owned `cordis.yml` through the real Loader and asserts that a bare `notes` row reaches active, that its schema defaults are what the row serves, and that unmounting the row frees the domain name. It waits on published services rather than on `loader.await()`, because a row's fiber settles before the services its `apply` mounts finish their asynchronous initialization. Its `agents` row is a sibling Loader row rather than a root-level provide, so the spec exercises the same resolution the shipped composition uses.

## Related

- [The notes design record](../../../../docs/superpowers/specs/2026-09-11-dsh-notes-design.md) — the feasibility findings, data model, and the four-phase change list.
- [The Phase 0-1 implementation plan](../../../../docs/superpowers/plans/2026-09-11-dsh-notes-host-core.md) — the task breakdown this phase follows.
