---
description: "Configuration and behavior of skill-settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-settings

English | [中文](README.zh.md)

## Summary

User-level skill enablement overrides over the [`@deepseek-ai/dsh-skill`](../skill) registry.

The plugin's Loader entry declares the live `disabled` roster as its Config, so the settings namespace is the entry id `skill-settings`; the roster is pushed into the registry's invocation-override slot. Disabling is total: a listed skill is neither model- nor user-invocable, so the model catalog, the `skill` tool, the `/name` gesture, and configuration listings agree. Changes take effect on the next registry read without clearing discovery caches, and a contained `skills/change` fan-out tells held catalog consumers to refetch.

Requirements: `ctx.skills` (`inject: ['skills']`); the settings service is optional.


## Table of Contents

- [Settings namespace: `skill-settings`](#settings-namespace-skills)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="settings-namespace-skills"></a>
## Settings namespace: `skill-settings`

| Field | Default | Meaning |
|---|---|---|
| `disabled` | `[]` | Kebab-case skill names the user switched off. Entries that are not valid skill names reject the write. |

`applies: live` — a committed change is visible to every consumer on the next catalog read, and the model sees a replacement catalog at the next pre-step.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the registry override read by `dsh-tool-skill` and the user-explicit invocation consumer.

#### KV Cache effect

Disabling appends a replacement catalog after the reusable prefix at the next pre-step; earlier tokens stay intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The override is global by name** — the same skill name in another project or scope is disabled too; overrides are not per-workspace or per-preset.
- **The namespace is writable only with a settings service** — without one, the composition entry is the roster and the catalog behaves exactly as composed.

<a id="dev-note"></a>
### Dev Note

None.

No runtime invariant companion is published. The package validates inputs at registration or writes and exposes no second authoritative state to compare against an independent event stream.
