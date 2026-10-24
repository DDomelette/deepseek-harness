---
description: "The experimental group map: pre-stable prototypes that are private by default, with explicit public Agent Teams packages."
kind: "package-group"
---

# packages/experimental

English | [中文](README.zh.md)

## Summary

The experimental group contains prototype capabilities whose contracts can change and carry no support promise. Packages are private by default; the five Agent Teams packages are published opt-in exceptions under their existing `@deepseek-ai/dsh-experimental-*` names. The group also holds the private cross-realm Inspector, CPython subprocess backend, and browser-worker preview packages. Released products outside this group must not depend on experimental packages.

## Table of Contents

- [Experimental, optional, and Official](#status)
- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="status"></a>
## Experimental, optional, and Official

**Experimental** means the complete public capability remains under evaluation and is not a product-support commitment. Its behavior or API may change, and the capability may be withdrawn; engineering, security, documentation, testing, and released-data obligations still apply. A package belongs here only when its entire public contract is experimental or internal-only; an experimental option inside a product package stays with that product role.

**Optional** means a user explicitly selects the capability. **Official** means the project maintains and lists the package in the Plugins page. Neither describes maturity; publication, default installation, and GUI visibility do not determine maturity either. Product packages outside this group have maintained product roles, while their public APIs still follow the repository's pre-stable policy.

Promotion requires a named product role, documented public behavior and limitations, current consumers, release contents, and test evidence. Move the package to its product group, apply that group's naming rules, and update affected consumers together. The [subtree rules](AGENTS.md) govern dependency isolation and publication.

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`agent-team-profile`](agent-team-profile/README.md) | Published opt-in profile layer for Agent Teams | — |
| [`agent-team`](agent-team/README.md) | Named teammates with durable messages and a shared task board | `ctx.agentTeams` |
| [`agent-team-web-profile`](agent-team-web-profile/README.md) | Published opt-in Web layer for Agent Teams | — |
| [`client-ui-agent-team`](client-ui-agent-team/README.md) | Team roster, task board, and teammate navigation for Web | — |
| [`ptc-runtime-python`](ptc-runtime-python/README.md) | CPython subprocess backend for the PTC execution seam | `ctx.ptcRuntime` |
| [computer-use-cua-driver-mcp](computer-use-cua-driver-mcp/README.md) | Use an installed Cua Driver through MCP | `ctx.computerUse` |
| [computer-use-cua-driver-native](computer-use-cua-driver-native/README.md) | Embed the Cua Driver native npm runtime | `ctx.computerUse` |
| [`browser-use-playwright-mcp`](browser-use-playwright-mcp/README.md) | Playwright browser tools over MCP | `ctx.browserUse` |
| [`browser-use-chrome-devtools-mcp`](browser-use-chrome-devtools-mcp/README.md) | Chrome DevTools inspection and browser control over MCP | `ctx.browserUse` |
| [`browser-use-stagehand-native`](browser-use-stagehand-native/README.md) | Stagehand browser operations with explicitly configured native models | `ctx.browserUse` |
| [`browser-use-runtime`](browser-use-runtime/README.md) | Session-owned browser resources shared by experimental providers | — |
| [`inspector`](inspector/README.md) | Cross-realm CDP hub for Host debugging, Client Runtime inspection, network capture, and Cordis trees | `ctx.inspector` |
| [`tool-agent-team`](tool-agent-team/README.md) | Nine tools that let the model create, message, and coordinate teammates | registers scoped tools on `ctx.tools` |
| [`webworker-packer`](webworker-packer/README.md) | Builds the gzip-compressed VFS image consumed by the browser worker preview | library and CLI — no ctx key |
| [`webworker-runtime`](webworker-runtime/README.md) | Runs the harness plugin tree inside a dedicated browser worker | library and worker entry — no ctx key |

-----

<a id="related-documentation"></a>
## Related documentation

- [Experimental package decision](../../.agents/notes/implemented/architecture/2026-08-18-experimental-agent-teams-packages.md) — private defaults, public Agent Teams exceptions, and dependency isolation.
- [Agent Teams subsystem](../../docs/subsystems/agent-team.md) — durable Team types and the `ctx.agentTeams` service API.
- [Computer use](../../docs/subsystems/computer-use.md) — desktop provider choices.
- [Browser use](../../docs/subsystems/browser-use.md) — browser provider choices and Session ownership.
- [Experimental subtree rules](AGENTS.md) — what experimental status does and does not relax.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
