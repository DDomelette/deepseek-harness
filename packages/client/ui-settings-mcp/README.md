# @deepseek-ai/dsh-client-ui-settings-mcp

English | [中文](README.zh.md)

**MCP** tab for the Plugins section of Web Settings. The browser plugin registers one localized `settings.plugins.tab` contribution with id `mcp` (order 5, between plugin configuration and the plugin list); the Plugins section owns the navigation entry and tab chrome. Selecting the tab lazily calls `ctx.remote.mcpServers.list()` through [`api-remotes`](../../api/remotes/README.md) and binds the `mcp-servers` settings namespace through `ctx.settingsScope` (see [`ui-settings`](../ui-settings/README.md)).

The tab renders a searchable roster of every MCP server the Host's [`mcp-manager`](../../mcp/mcp-manager/README.md) reports. Settings-managed rows carry an enablement switch that writes only the `enabled` leaf through a deep path op, after which the roster is re-read because the mount lifecycle answers asynchronously. A colored dot reports mount lifecycle (`connecting` / `ready` / `failed`) for enabled settings rows, with the startup failure summary under the title of a failed row; a settled mount is not a proven live connection, and the copy never claims one. Declarative rows (servers declared in cordis.yml) are read-only: they show a managed-by-config badge and their enablement tag, and their switch and gear stay disabled.

The rounded-square `+` button opens the add form: name, transport selector, the transport's fields (stdio command/args/env/cwd, or http URL/headers), and the per-call timeout. Validation runs inline on every change — serverName pattern, duplicates against the live roster, missing endpoints, timeout, and KEY=VALUE lines — and the save button stays disabled until the draft is valid. Args split on lines and commas; env and headers parse as KEY=VALUE lines and save through one whole-entry write, so the secrets just typed ride along.

The gear opens an inline editor prefilled from the redacted entry. Non-secret fields show their current values; env/headers always start blank with the keep-unchanged hint, and only the fields the user changed commit as per-field deep path ops — a blank secret field never rewrites the stored secret. Deleting asks for inline confirmation and clears the whole entry.

Loading, empty, no-match, and generic failure states stay local to the mounted component, and a failed read can be retried without exposing transport details. The registration uses `ctx.slots.inject()`, so it follows late tab declaration, redeclaration, locale changes, and teardown without importing the section owner.

## Model Experience

None, as this package only visualizes and edits a Host-owned roster in browser Settings and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Snapshot-driven roster** — the tab does not subscribe to roster changes; it re-reads after its own writes and on retry, and obtains a new snapshot when remounted.
- **Secret clearing is unsupported** — blank env/headers fields keep the stored values; clearing them requires deleting and re-adding the server.
- **Renaming is unsupported** — the serverName is the settings key; rename is delete + add.
