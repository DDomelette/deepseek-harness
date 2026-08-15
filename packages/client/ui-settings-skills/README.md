# @deepseek-ai/dsh-client-ui-settings-skills

English | [中文](README.zh.md)

The Skills settings section of the Web GUI: one icon per display group, drilling into a group's skill list with one toggle per skill.

Groups aggregate the current session's `skill.catalog` projection by the skill's declared `group` frontmatter, falling back to the discovery source (localized labels for the known sources). The page accepts a catalog and settings revision only when their disabled markers agree, rereading once after a concurrent change; toggles preserve disabled names outside the current catalog and write the complete list through the revision-guarded settings wire path. The host's [`@deepseek-ai/dsh-skill-settings`](../../skill/skill-settings) override makes the change effective for the model catalog, the `skill` tool, and the `/name` gesture.

The section registers on the `settings.section` slot declared by `@deepseek-ai/dsh-client-ui-settings` and refreshes after its first load on pushed `skills/change`, `connection/reset`, current-session switches, and `agent-preset/selected` for the current session.

## Model Experience

None, as this browser-side settings surface only edits Host settings; `dsh-skill-settings` and the skill consumers own every model-visible consequence.

#### KV Cache effect

The browser package contributes no model tokens and does not affect the KV cache directly.

## Known Limitations and Deferred Work

- **The panel is session-addressed** — it lists the current session's composition (project, preset, and user skills); the toggle itself stays user-global by name, so the same name elsewhere is affected too.
- **No search or per-group bulk actions** — the grid and drill-in list render the whole catalog; filtering and "enable all in group" are deferred.
- **The composer's `/` menu is the user-visible effect, not the panel** — the panel renders the effective flags from `skill.catalog`; it never writes frontmatter or provider files.
