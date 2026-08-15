# Agent Note: User-controllable skill enablement with a grouped settings panel

Status: implemented

English | [中文](2026-08-14-skill-settings-panel.zh.md)

## Problem

Skill invocation policy comes only from provider-owned frontmatter (`disable-model-invocation`, `user-invocable`). A user who wants a skill off — an unwanted superpowers plugin, a noisy project skill, a bundled skill they do not trust — must edit skill files or uninstall packages. Nothing user-facing shows the assembled catalog, and the Web GUI settings surface has no skill page, so "which skills will this agent use" is not inspectable or controllable from the product.

## Decision

Enablement is a user override, not a provider change. `@deepseek-ai/dsh-skill` gains `ctx.skills.registerInvocationOverride(override)` — the single registered resolver `(name) => policy | undefined`, applied to every produced summary and loaded definition (post-cache, so a changed answer takes effect on the next read without invalidation) and cleared only by its exact disposer. Clearing an active override emits `skills/change` so held catalogs refetch the restored provider policy. All model-facing consumers (`dsh-tool-skill`'s catalog, the `skill` tool, the `/name` gesture) and the user-facing `skill.list` RPC already filter by invocation policy, so they respect the override with no per-consumer wiring. The optional `group` string joins summaries, candidates, definitions, and runtime registrations as opaque presentation metadata; `dsh-skill-filesystem` parses it from frontmatter (`group: <label>`, wrong-typed values omitted like `whenToUse`), and the client-safe `./types` export now carries the seam's Events declaration. This extends the [skill system](2026-07-05-skill-system.md) and its [independent invocation policy](2026-07-28-skill-invocation-policy.md) without changing the [pre-step user-invocation path](2026-08-08-user-explicit-skill-invocation.md).

`@deepseek-ai/dsh-skill-settings` (host, mounted in the base bundle beside `tool-skill`) registers the `skills` settings namespace `{ disabled: string[] }` through the optional settings seam and feeds it into the registry override. Disabling is total — both invocation flags off. Entries that are not valid skill names reject the write; without a settings service the override resolves nothing and the catalog behaves exactly as composed. Every committed change of the namespace emits `skills/change` so consumers holding catalogs (menus, panels) refetch.

The gateway adds `skill.catalog`, a configuration-surface RPC addressed by `sessionId` with the same cwd/scope resolution as `skill.list`: every skill that session's composition resolves, with effective `modelInvocable`/`userInvocable` flags, the `group` label and `source` bucket for grouping, and the `disabled` marker read from the `skills` namespace. It is loopback-pinned in `dsh-client-connection` like the rest of the configuration plane, the `skills` namespace joins `WEB_SETTINGS_NAMESPACES`, and `skills/change` joins the forwarded-event allowlist so open panels and menus refetch on registry changes.

`@deepseek-ai/dsh-client-ui-settings-skills` (client) registers the Skills `settings.section` (order 30): one icon per display group — the declared `group` label, falling back to the localized discovery-source label — with a skill count; clicking drills into the group's skill list (name, description, user-only badge, per-skill switch). A load accepts the catalog and settings revision only when every catalog `disabled` marker agrees with the namespace value, rereading once when concurrent change separates them. Toggles derive the whole-array patch from that complete namespace value, preserving disabled names outside the current session catalog, then write `settings.update` with the page-read `expectedRevision`; success reloads the page, and a `settings-conflict` reloads before surfacing its message. The page addresses the current session (the shipped Web profile leaves skill discovery to presets, so a cwd-less registry view is empty) and refetches after its first load on `skills/change`, `connection/reset`, current-session switches, and `agent-preset/selected` for the current session.

## Verification

Registry unit tests pin the override (replacement in summaries and definitions, cached-catalog reapplication, exact disposer, duplicate refusal) and `group` validation. `dsh-skill-settings` tests pin the live disable/re-enable cycle, contained invalidation fan-out, absence of a settings service, write validation, and the policy restoration plus invalidation on fiber disposal. Gateway tests pin the `skill.catalog` projection and wire round-trip; connection tests pin the loopback pin for the new method. Client package tests pin grouping (declared group, source fallback, ordering), the store's revision-consistent catalog join, preservation of off-catalog disabled names, conflict reload, in-flight state, namespace absence, no-session posture, and the section's grid/drill-in/toggle behavior. A keyless browser e2e (`apps/web/tests/skills-settings.e2e.ts`) opens the real panel over the assembled composition, toggles a seeded skill, asserts the durable `settings.yaml` write, and verifies the skill leaves the composer's slash menu — the same registry override the model catalog reads.

## Alternatives considered

- **Filter at each consumer instead of the registry** — rejected: three consumers (model catalog/tool, user gesture, RPC listing) would each reimplement the same override join, and a future consumer would silently forget it. One registered resolver makes the override a property of the registry read everything already goes through.
- **Shadow skills through a high-priority provider** — rejected: a provider can only contribute whole skills; re-publishing overridden bodies would duplicate content, recurse into the registry it serves, and interact badly with scope layering and ranks.
- **Per-skill settings rows instead of a disabled list** — rejected: a `{ name: { enabled } }` map forces an editor to address arbitrary keys by path; a name list makes the panel's patch a whole-array merge the schema validates against the skill-name grammar.
- **Group strictly by frontmatter `group`** — rejected: ungrouped skills would each become their own icon, so the fourteen superpowers skills (which declare no group) would show fourteen icons. Source fallback collapses them into one localized group without touching user files.
- **A session-independent catalog over the global registry view** — rejected: the shipped Web profile disables the host-plane `skill-filesystem` row (presets own discovery), so a cwd-less view is empty. Addressing the current session reuses the exact resolution the composer menu uses and lists project skills too.

## Consequences

- Skill enablement is user-visible and user-controllable from the Web settings; a toggle is durable (`settings.yaml`), revision-guarded, and effective everywhere through one registry read.
- The override is global by name: a same-named skill in another project or preset layer is disabled too. The panel lists the current session's composition — project, preset, and user skills alike — because the shipped Web profile leaves skill discovery to presets and a cwd-less registry view is empty.
- The `skill.catalog` wire rows expose `source` and `group` strings (the former previously host-side vocabulary): consumers localize the known sources and render unknown ones verbatim.
- `skills/change` forwarding adds a typed Events dependency between `dsh-skill`'s client-safe `./types` and `dsh-api-remotes`, following the existing per-owner `./types` pattern.
- Frontmatter gains one optional, presentation-only field (`group`); invocation semantics are untouched for skills a user did not disable.
