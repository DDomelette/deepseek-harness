---
description: "The preset group map: per-session agent composition from preset files, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/preset

English | [中文](README.zh.md)

## Summary

The preset group provides per-session agent composition: an agent preset is one `@deepseek-ai/dsh-agent-preset` row whose `plugins` list is an ordinary Cordis entry list, and a session composed from a preset runs that preset's tools, prompt sections, and skills while every other session keeps its own. `agent-preset-registry` owns the roster and revision retention, `agent-preset` contributes the declaration row and ships the composition-authoring skills, and `persona` supplies the composable identity row. The four shipped presets (`standard`, `ptc`, `minimal`, `cordis`) travel as `presets/<id>.patch.yml` files of the `dsh-web-app` bundle.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`agent-preset-registry`](agent-preset-registry/README.md) | Preset roster: declared definitions, the standing mount a session joins, and revision retention | `ctx.agentPresets` |
| [`agent-preset`](agent-preset/README.md) | One `@deepseek-ai/dsh-agent-preset` declaration row, plus the composition-authoring skills the `cordis` preset mounts | — |
| [`persona`](persona/README.md) | The composable persona row a preset mounts to shadow or replace the deployment persona | — |

-----

<a id="related-documentation"></a>
## Related documentation

- [`AgentPresets` reference](../../docs/subsystems/core.md#ctxagentpresets--agentpresetregistry) — discovery, mounting, inheritance, and recomposition.
- [Scope subsystem](../../docs/subsystems/scope.md) — scope keys and the parent chain the mount uses to join agents.
- [System prompt subsystem](../../docs/subsystems/system-prompt.md) — how preset prompt sections register and assemble.
- [Per-session agent presets note](../../.agents/notes/implemented/architecture/2026-08-03-per-session-agent-presets.md) — design rationale and alternatives.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
