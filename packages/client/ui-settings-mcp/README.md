# @deepseek-ai/dsh-client-ui-settings-mcp

English | [中文](README.zh.md)

**MCP** tab for the Plugins section of Web Settings. The browser plugin registers one localized `settings.plugins.tab` contribution with id `mcp` (order 5, between plugin configuration and the plugin list); the Plugins section owns the navigation entry and tab chrome. Selecting the tab lazily calls `ctx.remote.mcpServers.list()` through [`api-remotes`](../../api/remotes/README.md) and binds the `mcp-servers` settings namespace through `ctx.settingsScope` (see [`ui-settings`](../ui-settings/README.md)).

The tab renders a searchable roster of every MCP server the Host's [`mcp-manager`](../../mcp/mcp-manager/README.md) reports. Settings-managed rows carry an enablement switch that writes through the settings scope — the write merges over the scope snapshot's current entry so fields the tab does not render ride along unchanged — after which the roster is re-read, since the mount lifecycle answers asynchronously. A colored dot reports mount lifecycle (`connecting` / `ready` / `failed`) for enabled settings rows, with the startup failure summary under the title of a failed row; a settled mount is not a proven live connection, and the copy never claims one. Declarative rows (servers declared in cordis.yml) are read-only: they show a managed-by-config badge and their enablement tag, and their switch and gear stay disabled. The rounded-square `+` button switches to the add view, which is a title-and-back placeholder until the add form lands.

Loading, empty, no-match, and generic failure states stay local to the mounted component, and a failed read can be retried without exposing transport details. The registration uses `ctx.slots.inject()`, so it follows late tab declaration, redeclaration, locale changes, and teardown without importing the section owner.

## Model Experience

None, as this package only visualizes and edits a Host-owned roster in browser Settings and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Snapshot-driven roster** — the tab does not subscribe to roster changes; it re-reads after its own writes and on retry, and obtains a new snapshot when remounted.
- **Enablement writes merge over the redacted view** — `SettingsScope.set(serverName, value)` replaces the whole field at path `[serverName]`, and the scope snapshot may omit secret-role fields (`env`/`headers`); a merge built from the snapshot would then clear stored secrets. The definitive secret-preserving write path (fine-grained path ops informed by the wire's secret-slot descriptor) is deferred to the edit task.
- **Placeholder add view and disabled gear** — the add form and the per-row edit view are later tasks; the gear ships disabled.
