---
description: "Web notes panel: session material kept as notes, each answered by a configured model in its own conversation."
kind: "package-reference"
---

# @deepseek-ai/dsh-notes

English | [中文](README.zh.md)

## Summary

`dsh-notes` keeps material a user wants to return to. A text selection or a screenshot collected from a dsh conversation becomes a note, and a configured model answers each note in its own conversation, so the note's questions stay out of the session the material came from. One package carries both halves: the Host half owns the notes storage domain, the settings section, the notes conversations, and the `notes` Remote namespace; the browser half owns the right column's notes tab and the conversation-header control that opens it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use this package when a Web deployment should keep session material as notes that the configured model answers one by one. Mount it in a composition that already provides the storage hub's domain facility; the plugin opens its own `notes` domain and needs no additional storage row.

### Composition

```yaml
- id: notes
  name: '@deepseek-ai/dsh-notes'
```

A bare row needs no `config`: the schema defaults the strategy to `manual` and the action list to the built-in `translate` action.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `strategy` | `manual` | `manual` waits for an explicit analyse; `auto` analyses each material as it is collected. |
| `actions` | one `translate` feature | The selection features the bubble offers. |
| `actions[].id` | — | Stable feature id, stored as the material's own `action`. |
| `actions[].label` | — | Localized label the selection bubble shows. |
| `actions[].prompt` | — | Prompt text prepended to the material body before submission. |
| `actions[].autoSend` | `false` | Whether picking the feature analyses immediately, ignoring the strategy. |
| `workspace` | absent | Absolute directory the notes conversations run in; set from the settings card or the composition entry. |
| `model` | absent | Model override for notes conversations; absent follows the session default. |
| `model.provider` | — | Registered provider route. |
| `model.model` | — | Provider-owned model id. |
| `model.reasoningEffort` | absent | Adapter-owned reasoning effort for that route; absent asks for the route's own default. |

### Host services

The plugin mounts six services, and each is the documented owner of its slice of the contract. `ctx.notesStore` opens the notes domain and holds the material and conversation tables; `ctx.notesMaterials` stores materials, their manual order, and their archived bucket; `ctx.notesSessions` starts a conversation over the configured workspace and model, records one entry per conversation, and holds the panel's active pointer; `ctx.notesSettings` reads the settings section above, falling back to the composition entry when no settings provider is mounted; `ctx.notesAnalysis` turns one material into one user message on its conversation; `ctx.notes` is the Remote namespace the browser panel calls, whose operations answer with the wire vocabulary in `src/types.ts` — a successful value or a named refusal — so nothing reaches the panel as a thrown error.

### Browser half

The browser half registers one page type with `ctx.sidebarRightTabs` — kind `notes`, opened by name and recognizing no resource address — and draws it from the keyed `sidebar.right.pane.tab` seat. The panel shows two columns while its pane is wide enough for both, the material list and the open material's detail, and one at a time below 560px, where the reader moves between them; below 560px the navigation bar drops its control labels and leaves the icons. A row carries its state, its source, two lines of its text, and the collection action that produced it, under an archived bucket the reader folds open. Its body is editable until the material entered its conversation, and the follow-up box is drawn once it has, matching what the Host enforces; the analysis control is drawn exactly while the material is still a draft, and the refresh control re-reads the conversations, the shown conversation's materials, and the open material's thread, as does a settlement the Host forwards when a turn closes, so an answer that arrived while the detail was open appears without the reader asking again. Every thread row and a submitted body render as Markdown — a collected passage is as likely to be a document as it is to be prose, so both sides of a thread read as written — while the editor a draft is typed in stays plain text. The detail also echoes the prompt template of the action the material names and offers to copy the body it shows. The conversation chip in the navigation bar lists every conversation, archived ones included, and picking an archived one brings it back; the controls beside it start a conversation, archive the one shown, re-read everything, move the panel between its docked and floating presentations — the window opens at 640×480, clamped to a small viewport, against the viewport's right edge and centered vertically, so the two-column band fits inside it — add a screenshot, and open a settings card over the notes section. A control in the conversation header's corner seat opens the tab, and opening it again reveals the tab already there rather than adding a second one. The browser half also covers the conversation itself: a bubble over the selected passage offers the deployment's collection actions, and picking one stores the passage in the shown conversation — starting the first conversation when there is none. A screenshot picked from the panel's navigation bar, or pasted anywhere inside the panel, is stored the same way, as a material whose body is a durable attachment reference rather than the bytes; the paste listener sits on the panel, so a paste in the conversation's composer stays the model's attachment. The panel and the bubble are one store instance rather than two, so a passage collected over the conversation lands in the state the panel is rendering; both read and write only through `ctx.remote.notes`, so neither holds a rule the Host would not apply.

### Settings

The settings card edits the same section the composition entry seeds: the model-call strategy, the workspace, the model override, and each selection feature's name and prompt. It writes one field at a time through `notes/settingsUpdate`, which unsets a field rather than storing null, so clearing the workspace or the model override returns that field to the composition default. The feature list is the exception to one-field writes: the card sends the complete list with the edited feature replaced, because the list is one document value. The Host refuses a list whose feature carries a blank id, label, or prompt, or two features sharing an id, and reports `invalid-actions`; the card also offers no save while a field is blank.

The directory field carries a chooser button that asks the host for a directory over the wire: a deployment whose picker serves a native chooser opens it, and one that serves only the browse primitives gets an in-card browser instead — the listed level, its child directories, and the controls to descend, step up, take the level, or leave it, with the volumes the host reports one step above a drive root. A cancelled chooser or browser leaves the field as typed, and a level the host cannot read reports `directory-unavailable`.

The model picker offers the routes the deployment's own catalog serves, grouped by provider, read from the same session operation the conversation's model picker uses; each route's declared reasoning efforts appear as a second picker, and a route the catalog no longer advertises stays selectable while the section stores it. The selection feature picker lists the configured features and the editor beside it renames one or adds one: an added feature gets the next free `custom-N` id, a blank name or prompt is refused, and the add row sits below the picker. A deployment with no writable settings provider reports that instead of offering the controls.

### What to expect

A material is stored first and submitted later, so collecting never blocks on a model. A new conversation registers the configured directory as a workspace titled `笔记` when nothing registered it yet, joins that workspace as an accounted Session, and carries the title `笔记 · NN` — the notes prefix and the two-digit count of the records the domain holds, archived ones included — both on its own record and on the Session, so the reader's session list groups the notes conversations together and names each row instead of labelling it with the directory's name. Analysis and follow-ups both call `Agent.followup()` on the material's own notes conversation — never on the session the material was collected from — and each submission occupies its own step, so two materials always produce two answers. A submitted material is `analyzing` until the turn that carried it closes: the model answering makes it `analyzed`, and a turn that failed or was aborted makes it `failed` with the reason — so the panel's state is the model's outcome, not a guess. A send the inbox refuses marks the material `failed` immediately and rolls the recorded message id back, so the material stays analysable, and the Host reports that refusal as `submit-refused` with the reason rather than as an unreachable Host; a material the deployment submits on collection reports that refusal in place of the stored id. Two analyses of one material racing each other send once: the first caller claims the material on the domain's write chain, and the loser sees the recorded id and submits nothing. The operations that mint a material's order value are serialized for the same reason, so a new material always lands above the previous one. A conversation that is the last unarchived one cannot be archived, so the panel always has one to show. A screenshot is submitted like any other material, as the image block naming the reference its store returned, and its row in the thread says it carried an image; a conversation whose model declares text-only input reports `image-unsupported` instead of sending it, and a follow-up on a material that has not entered its conversation reports `material-not-submitted`. A screenshot's own body is that reference, so the detail pane names it instead of offering an editor, and `materialUpdate` reports `material-not-text` if a caller asks to rewrite one anyway.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the Host half is wired; the observable behavior is covered in [Use this package](#use-this-package).

The `./types` and `./remote-events` subpaths expose declarations for type-only imports. Runtime consumers use the root Host entry, the `./client` browser bundle, or the generated `./typert` and `./remote` entries; browser styles are included in the client bundle.

### Storage

The session log stays the content truth. The plugin's own domain stores only what the log cannot answer: which materials exist, their manual order, which of their user messages were submitted, and which conversation the panel is showing. A material's text and a model's answer are read back from session events, never copied here. `ctx.storageDomain.open` admits one open per domain name, so a single owner (`ctx.notesStore`) opens the domain and hands its tables to every other consumer.

### Submission

`src/analysis.ts` composes the content, mints the user message with `createUserMessage`, records the message id, and only then calls `followup`. `src/compose.ts` decides what the content is: a text material contributes one text block with the action's template in front of its body, and a screenshot contributes the image block naming the reference the material stored, with that template as a text block ahead of it. The order is deliberate: `Agent.followup()` returns void, so the sequence a message lands on is not knowable at the call site, while its id is knowable before the send. A refused send rolls the id back — otherwise the material would read as already submitted and could never be retried.

A submission's outcome is settled by the turn that carried it. `src/turns.ts` reads that turn back out of the session log — which of its user messages it carried, and whether the model answered it — when the log publishes `turn/end`, and `Analysis` moves each of its own materials that is still `analyzing` to `analyzed` or `failed`. The log is the source rather than memory, so a restored conversation settles the same way.

A draft edit and the first analysis share the material table's write queue. An edit committed first supplies the submitted body; an analysis committed first makes the edit return `material-submitted`. Submission composes from the record that accepted its message id, keeping the stored body and model input aligned.

### Answer arrival

A settlement is the one outcome no call returns: it happens when the log publishes `turn/end`, with no browser operation waiting for it. `Analysis` therefore emits `notes/material-settled` with the conversation and the materials that moved, and `src/remote-events.ts` declares that name into the Remote event selection while `packages/api/remotes/src/remote-events.ts` allows it through — without both, the pushed name never reaches the page. The browser half follows it into a revision published as a reactive fact on the tab registration, which the panel re-reads on; the revision is deliberately not store state, because the shared store instance belongs to the slot runtime and `apply` minting a second one would leave the panel rendering a different snapshot than the one being told.

A forced refresh received during a listing schedules another read after it finishes; concurrent refreshes share that pending read. Callers wait for the refreshed listing before reading the open thread, and an older thread response cannot replace a newer one.

### Thread attribution

`src/thread.ts` answers which session events belong to one material. Attribution is explicit, never positional: the material records the ids of its own user messages, and each of those takes the events up to the next prompt the conversation received. A follow-up asked long after the first analysis, and after other materials were analysed, still lands in the right thread. The harness's own context — workspace instructions, the system-prompt snapshot, the skill catalog — lands in the log as user messages inside the same turn, so it is carried by the segment and drawn as no row; a prompt is the user message that declares no context form, whether a person or a plugin sent it.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough.

- [dsh-storage-domain](../../storage/storage-domain/README.md) — the domain data form this plugin opens its own domain on.
- [Storage subsystem](../../../docs/subsystems/storage.md) — the durable store the notes domain lives in.
- [Settings subsystem](../../../docs/subsystems/settings.md) — the user-settings namespace that carries the strategy, actions, workspace, and model override.
- [Session subsystem](../../../docs/subsystems/session.md) — the log that holds each note's conversation.
- [notes group](../README.md) — the package group this plugin belongs to.

-----

<a id="model-experience"></a>
## Model Experience

### Note submission

#### What the model sees

One `user/message` per analysis or follow-up, on that material's own notes conversation. A text material submits its text; a material collected through an action carries that action's configured prompt template prepended on its own line, in front of the image when the material is a screenshot. A screenshot submits an image block naming the durable reference its store returned, so the model reads the picture itself. The message source is `{ kind: 'plugin', plugin: 'notes' }`, so the transcript attributes it to this plugin rather than to the user. A conversation whose route declares text-only input is refused before anything is sent (`image-unsupported`), so the model never receives a placeholder in place of the screenshot.

#### Token effect

The submitted body plus the ordinary per-message framing of the notes conversation. Nothing is sent while a material is a draft, and the action template is configuration, so a deployment changes its length without a code change.

#### KV Cache effect

None on the derived request prefix. Each submission appends to its own conversation's history, so a notes conversation grows the way any other conversation does, and no other session's prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when this package is a poor fit or needs special operational care. They are current constraints, not a task backlog.

- **A material is analysed once** — the detail offers 分析 while the material is still a draft, because the Host submits a material's first message at most once. A material whose turn failed keeps its recorded message, so it reports the failure and cannot be submitted again; only a send the inbox refused rolls the id back and stays analysable.
- **A collected passage records where it came from, but nothing opens it yet** — the bubble reads `seq`, `messageId`, and `callId` from the DOM row the selection started in, and the source strip offers a `Locate ↗` entry whenever one of them was recorded; clicking it reports that this version cannot open the source, because the conversation's public face offers no view navigation to a panel outside the conversation slot tree. A material collected from the panel's own control records no row, so it offers no entry at all.
- **A screenshot comes from the panel, not from the conversation** — `notes/materialAddImage` stores the reference its attachment store returns and submits that reference as the image block, and the panel takes the image from its own picker or from a paste inside the panel, one screenshot per paste; nothing captures a region of the conversation itself, and a paste in the conversation's composer remains an attachment for the model.
- **A route that declares text-only input refuses the screenshot** — the conversation's model metadata decides: an explicit text-only declaration reports `image-unsupported` and the panel asks for another model, while a route whose modalities are unknown is treated as capable and the request assembly decides.
- **A notes conversation must be live** — `analyse` and `ask` resolve the live Agent through `ctx.agents`, so a conversation whose process restarted reports `session-not-live` until it is reopened, and a material whose turn never closed stays `analyzing` because only a closing turn settles one.
- **A settlement is only followed while the page is connected** — the forwarded event carries no backlog, so a settlement that lands while the page is closed or reconnecting is not replayed. The answer is in the log either way: the panel takes it at its next settlement, or when the reader refreshes.
- **A material that entered its conversation is fixed** — `materialUpdate` reports `material-submitted` once a material has a recorded message, because the session log carries the submitted body and rewriting the record would desync the row from its thread.
- **Orphaned attachments are never reclaimed** — a material deleted while still a draft leaves its uploaded bytes behind, matching the attachment facility's existing semantics.
- **Conversations restore in creation order** — a restored conversation returns to its creation position rather than the top of the list, because the record carries no separate order value.
- **A conversation needs a configured workspace** — starting one before the notes workspace is set reports `workspace-missing`; this phase ships no first-run setup screen, so the workspace comes from the settings document or the composition entry.
- **A conversation joins the notes workspace when it is created** — the plugin registers the configured directory and accounts the new Session on it at creation, so a conversation recorded before its directory was registered keeps the listing it had (the directory's name, under the ungrouped heading) and is never adopted retroactively.
- **The names this plugin writes are Chinese literals** — a new conversation is titled `笔记 · NN` and a directory this plugin registers is named `笔记`, both written on the Host before any reader locale exists, so they are not locale-owned copy. A directory the reader had already registered keeps the name they gave it, and renaming the Session later in the session list changes that row but not the panel's own conversation chip.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked pages.

#### Next phases

What is left is the navigation half of the locate entry and capturing the conversation itself: the locate entry exists and reports where the material came from, but opening that row needs `IConversation.openView` on the product side, and a screenshot comes from the panel's picker or a paste rather than from a region of the conversation. The design record for the whole feature is `docs/superpowers/specs/2026-09-11-dsh-notes-design.md`.

</details>

**Runtime invariant:** No companion is published. The domain, the material store, the conversation records, and the settings owner each read the authority they own, so no independent observations can diverge.
