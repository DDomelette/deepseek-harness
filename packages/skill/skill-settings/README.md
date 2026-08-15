# @deepseek-ai/dsh-skill-settings

English | [中文](README.zh.md)

User-level skill enablement overrides over the [`@deepseek-ai/dsh-skill`](../skill) registry.

The plugin registers the `skills` settings namespace (`{ disabled: string[] }`) through the optional settings seam and pushes it into the registry's invocation-override slot. Disabling is total: a listed skill is neither model- nor user-invocable, so the model catalog, the `skill` tool, the `/name` gesture, and configuration listings all agree. Changes take effect on the next registry read without clearing discovery caches, and a contained `skills/change` fan-out tells held catalog consumers to refetch.

Requires `ctx.skills` (`inject: ['skills']`); the settings wiring is optional and mounts only while a settings service exists.

## Settings namespace: `skills`

| Field | Default | Meaning |
|---|---|---|
| `disabled` | `[]` | Kebab-case skill names the user switched off. Entries that are not valid skill names reject the write. |

`applies: live` — a committed change is visible to every consumer on the next catalog read, and the model sees a replacement catalog at the next pre-step.

## Model Experience

Indirectly, through the registry override read by `dsh-tool-skill` and the user-explicit invocation consumer.

#### KV Cache effect

Disabling appends a replacement catalog after the reusable prefix at the next pre-step; earlier tokens stay intact.

## Known Limitations and Deferred Work

- **The override is global by name** — the same skill name in another project or scope is disabled too; overrides are not per-workspace or per-preset.
- **The namespace registers only with a settings service** — without one, no overrides exist and the catalog behaves exactly as composed.
