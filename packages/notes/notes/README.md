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
| `actions` | one `translate` action | The collection actions the selection bubble offers. |
| `actions[].id` | — | Stable action id, stored as the material's own `action`. |
| `actions[].label` | — | Localized label the selection bubble shows. |
| `actions[].prompt` | — | Prompt text prepended to the material body before submission. |
| `actions[].autoSend` | `false` | Whether picking the action analyses immediately, ignoring the strategy. |
| `workspace` | absent | Absolute workspace path for notes conversations, chosen at first-run setup. |
| `model` | absent | Model override for notes conversations; absent follows the session default. |
| `model.provider` | — | Registered provider route. |
| `model.model` | — | Provider-owned model id. |

### Host services

The plugin mounts six services, and each is the documented owner of its slice of the contract. `ctx.notesStore` opens the notes domain and holds the material and conversation tables; `ctx.notesMaterials` stores materials, their manual order, and their archived bucket; `ctx.notesSessions` starts a conversation over the configured workspace and model, records one entry per conversation, and holds the panel's active pointer; `ctx.notesSettings` reads the settings section above, falling back to the composition entry when no settings provider is mounted; `ctx.notesAnalysis` turns one material into one user message on its conversation; `ctx.notes` is the Remote namespace the browser panel calls, whose operations answer with the wire vocabulary in `src/types.ts` — a successful value or a named refusal — so nothing reaches the panel as a thrown error.

### Browser half

The browser half registers one page type with `ctx.sidebarRightTabs` — kind `notes`, opened by name and recognizing no resource address — and draws it from the keyed `sidebar.right.pane.tab` seat. A control in the conversation header's corner seat opens that tab, and opening it again reveals the tab already there rather than adding a second one. The panel reads and writes only through `ctx.remote.notes`, so it holds no rule the Host would not apply.

### What to expect

A material is stored first and submitted later, so collecting never blocks on a model. Analysis and follow-ups both call `Agent.followup()` on the material's own notes conversation — never on the session the material was collected from — and each submission occupies its own step, so two materials always produce two answers. A send the inbox refuses marks the material `failed` with the reason and rolls the recorded message id back, so the material stays analysable. Two analyses of one material racing each other send once: the first caller claims the material on the domain's write chain, and the loser sees the recorded id and submits nothing. The operations that mint a material's order value are serialized for the same reason, so a new material always lands above the previous one. A conversation that is the last unarchived one cannot be archived, so the panel always has one to show.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the Host half is wired; the observable behavior is covered in [Use this package](#use-this-package).

### Storage

The session log stays the content truth. The plugin's own domain stores only what the log cannot answer: which materials exist, their manual order, which of their user messages were submitted, and which conversation the panel is showing. A material's text and a model's answer are read back from session events, never copied here. `ctx.storageDomain.open` admits one open per domain name, so a single owner (`ctx.notesStore`) opens the domain and hands its tables to every other consumer.

### Submission

`src/analysis.ts` composes the body, mints the user message with `createUserMessage`, records the message id, and only then calls `followup`. The order is deliberate: `Agent.followup()` returns void, so the sequence a message lands on is not knowable at the call site, while its id is knowable before the send. A refused send rolls the id back — otherwise the material would read as already submitted and could never be retried.

### Thread attribution

`src/thread.ts` answers which session events belong to one material. Attribution is explicit, never positional: the material records the ids of its own user messages, and each of those takes the events up to the next user message. A follow-up asked long after the first analysis, and after other materials were analysed, still lands in the right thread.

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

One `user/message` per analysis or follow-up, on that material's own notes conversation. The body is the material's text; a material collected through an action carries that action's configured prompt template prepended on its own line. The message source is `{ kind: 'plugin', plugin: 'notes' }`, so the transcript attributes it to this plugin rather than to the user.

#### Token effect

The submitted body plus the ordinary per-message framing of the notes conversation. Nothing is sent while a material is a draft, and the action template is configuration, so a deployment changes its length without a code change. Images become an image content part once screenshot collection lands; this phase stores text bodies only.

#### KV Cache effect

None on the derived request prefix. Each submission appends to its own conversation's history, so a notes conversation grows the way any other conversation does, and no other session's prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when this package is a poor fit or needs special operational care. They are current constraints, not a task backlog.

- **The panel is a skeleton** — the tab, the header control, the conversation listing, and one row per material exist; the two-column list-and-detail layout, the selection bubble that collects from a transcript, and the settings card are later phases.
- **Screenshots are not collected yet** — the material record already carries a durable attachment reference field, but no path stores an image or resolves one into a request, and the Remote namespace has no `materialAddImage` operation.
- **A notes conversation must be live** — `analyse` and `ask` resolve the live Agent through `ctx.agents`, so a conversation whose process restarted reports `session-not-live` until it is reopened.
- **A material that entered its conversation is fixed** — `materialUpdate` reports `material-submitted` once a material has a recorded message, because the session log carries the submitted body and rewriting the record would desync the row from its thread.
- **Orphaned attachments are never reclaimed** — a material deleted while still a draft leaves its uploaded bytes behind, matching the attachment facility's existing semantics.
- **Conversations restore in creation order** — a restored conversation returns to its creation position rather than the top of the list, because the record carries no separate order value.
- **A conversation needs a configured workspace** — starting one before the notes workspace is set reports `workspace-missing`; this phase ships no first-run setup screen, so the workspace comes from the settings document or the composition entry.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked pages.

#### Next phases

The Host half is complete apart from screenshot collection, and the browser half is a skeleton reaching real operations; the two-column layout, the selection bubble, and the floating and docked presentations are the next pieces. The design record for the whole feature, including the deferred "locate the source text" entry point, is `docs/superpowers/specs/2026-09-11-dsh-notes-design.md`.

</details>

**Runtime invariant:** No companion is published. The domain, the material store, the conversation records, and the settings owner each read the authority they own, so no independent observations can diverge.
