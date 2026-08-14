# Agent Note: MCP settings page — panel-managed MCP servers beside declarative ones

Status: implemented

English | [中文](2026-08-13-mcp-settings-page.zh.md)

## Problem

MCP servers were configured declaratively only: one `@deepseek-ai/dsh-mcp-client` row per server in `cordis.yml`, as recorded in the [mcp-client Agent Note](2026-07-07-mcp-client-plugin.md). A Web user could not add, disable, edit, or remove a server without editing the configuration file and hot-reloading. The settings dialog's Plugins section had no MCP page.

## Decision

### Two sources, one roster

A new Host package `@deepseek-ai/dsh-mcp-manager` (`packages/mcp/mcp-manager`) and a new client package `@deepseek-ai/dsh-client-ui-settings-mcp` (`packages/client/ui-settings-mcp`). The Web Plugins section gains an MCP tab (order 5, between 插件配置 and 插件列表). The roster merges two sources:

- settings-managed servers from the `mcp-servers` settings namespace, whose schema mirrors the `dsh-mcp-client` Config plus an `enabled` flag, keyed by `serverName` — editable in the tab;
- declarative rows projected from `ctx.loader.entries()` where the module is `@deepseek-ai/dsh-mcp-client`, shown read-only (badge 由配置文件管理, switch and gear disabled).

`dsh-mcp-client` itself is untouched: the manager hot-mounts one instance per enabled settings entry.

### Persistence and hot apply

The `mcp-servers` namespace persists through the settings pipeline into `$DSH_HOME/settings.yaml` — schema validation, revision fencing, secret redaction. The manager watches the resolved section and reconciles a diff: a new or re-enabled entry mounts; a disabled or removed entry disposes; any other field change remounts (dispose first, because `dsh-mcp-client` reserves `serverName` per app root for a fiber's whole lifetime). Reconciliation runs on a serial queue; disabled entries stay listed by the gateway with no status.

### Name ownership

A settings entry whose `serverName` collides with a declarative row is refused at write time by the namespace's `validate` hook; `dsh-mcp-client`'s own per-root `serverName` reservation remains the load-time backstop for any path that bypasses the settings seam.

### Secret handling

`env` and `headers` are `role('secret')` schema fields. The wire never returns them, so every client write names the leaves it means: the enablement switch writes path `[serverName, enabled]`; the editor sends one per-field deep path op per changed field and leaves blank env/headers fields out of the patch entirely. This required extending the client settings scope contract with `SettingsScope.setPath` — the shared contract previously exposed only whole-field set/unset, and a whole-field write rebuilt from the redacted view silently deletes stored secrets.

### Status reporting

The gateway reports mount lifecycle only (connecting → ready/failed), not liveness: with `failOnStartupError: false` an unreachable server still activates and `dsh-mcp-client` reconnects internally, so `ready` means activation settled, not that the server answered. The tab's status dot labels read 运行中/启动失败 accordingly. `dsh-mcp-client`'s public API gains nothing; the supervisor wraps the mount fiber.

## Alternatives considered

**Edit cordis.yml from the browser.** Writes would target the configuration file the deployment composes, mixing user-owned state with deployment-owned composition, and every edit would need a loader reload cycle. The settings user layer already layers over composition defaults with revision fencing and secret redaction.

**Extend mcp-client with a roster service.** The manager is a separate concern — settings, diffing, lifecycle — and `dsh-mcp-client`'s one-instance-per-server shape stays unchanged; a headless caller can consume the same settings namespace without touching the bridge.

**Whole-entry writes with a client-side merge.** Rejected, and this is the failure the per-leaf rule prevents: merging over the redacted snapshot and writing the whole entry back deletes the `env`/`headers` the wire never returned. Per-leaf path ops are the only write that preserves secrets without a secret round-trip.

## Consequences

- A duplicate settings/declarative name fails the write (validate hook) and would fail the mount (`dsh-mcp-client` reservation) — loud at both layers.
- Toggling, editing, or removing a server takes effect without a Host restart; the supervisor remounts on the settings commit.
- Blank secret fields mean "keep the stored value"; clearing all env/headers from the UI is deliberately unsupported — delete and re-add to start without secrets.
- The status dot reports lifecycle, not liveness; a crash-looping server keeps showing 运行中 while `dsh-mcp-client` retries, per the [reconnect Agent Note](2026-08-06-mcp-client-auto-reconnect.md).
- Renaming a server is not offered: the dict key is the name, so rename is remove + add.

## Testing

- `packages/mcp/mcp-manager`: schema, registration and write-time refusal, supervisor diff and mount/dispose/remount, gateway merge; per-file 100% coverage.
- `packages/client/ui-settings-mcp`: tab, add form, edit form, controller per-leaf writes; 100% coverage.
- `apps/web/tests/mcp-config.e2e.ts`: real scaffold — add/toggle/remove write through to `$DSH_HOME/settings.yaml`, search, and the declarative row under the memorix example overlay; aria golden in `snapshots/mcp-config`.
- `SettingsScope.setPath`: unit tests in `packages/client/ui-settings/tests/settings-scope.client.spec.ts`.

## Deferred

- Rename, secret clearing, and server directories or catalogs.
- Liveness (vs lifecycle) status would need a status face on `dsh-mcp-client`.
