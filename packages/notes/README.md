---
description: "The notes package group: the Web notes panel that keeps session material as notes and answers each one in its own conversation, for users and maintainers navigating the group."
kind: "package-group"
---

# notes/ — the Web notes panel

English | [中文](README.zh.md)

## Summary

The notes group keeps material a user wants to return to: a text selection or a screenshot from a conversation becomes a note. A configured model answers each note in its own conversation, so the note's questions and follow-ups stay out of the session the material came from. The group's single package carries both halves of the panel: the Host half owns the notes storage domain, the settings namespace that names the answering model, and the sessions a note runs in; the browser half owns the panel that collects, lists, and opens notes.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The group's single package carries both halves of the panel.

| Package | Role |
|---|---|
| `notes/` | Web notes panel: collects text and screenshots from a session as notes, and has a configured model answer each one in its own conversation |

-----

<a id="related-documentation"></a>
## Related documentation

- [Storage subsystem](../../docs/subsystems/storage.md) — the domain form that holds the collected notes.
- [Settings subsystem](../../docs/subsystems/settings.md) — the user-settings namespace that names the model answering a note.
- [Session subsystem](../../docs/subsystems/session.md) — the log that records each note's conversation.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
