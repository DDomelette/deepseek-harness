# MCP settings page design (Web settings dialog)

English | [中文](2026-08-13-mcp-settings-page-design.zh.md)

Date: 2026-08-13 Status: approved (to implement)

## Background and goals

DeepSeek Harness already supports MCP end to end (`@deepseek-ai/dsh-mcp-client`, one plugin instance per server, wired declaratively through cordis.yml), but the Web settings dialog has no MCP panel. This design adds an MCP tab to the Plugins settings page, reusing the existing generic settings pipeline:

- Show existing MCP servers (settings-managed and cordis.yml-declared)
- Per-server enablement switch, applied hot
- A rounded-square `+` button in the top-right corner opens the add page (fields follow the `dsh-mcp-client` Config schema)
- MCP server search box
- Visual style consistent with the existing settings page

## Confirmed key decisions

1. **Persistence**: the settings namespace `mcp-servers` ($DSH_HOME/settings.yaml), reusing the settings pipeline (schema validation, revision conflict control, secret redaction, api-proxy allowlist, document-updated hot reload). cordis.yml is not written.
2. **Effect timing**: hot apply — mcp-manager watches settings; toggling, adding, or removing disconnects/reconnects immediately.
3. **Declarative coexistence**: cordis.yml-declared MCP servers are listed read-only (source badge 「由配置文件管理」, switch/edit disabled).
4. **Implementation route**: a new host package `dsh-mcp-manager` plus a new client package `ui-settings-mcp`; mcp-client's one-instance-per-server model stays unchanged.

## Architecture

```
host 侧
  packages/mcp/mcp-manager（@deepseek-ai/dsh-mcp-manager，新包）
    · ctx.settings.register('mcp-servers', schema, { applies: 'live', validate })
    · watch → diff → 动态 ctx.plugin(McpClient, config) 挂载 / dispose
    · remote service mcpServers.list()：settings 与 declarative 两来源并集
  packages/mcp/mcp-client：不改动
  packages/host/apiproxy：WEB_SETTINGS_NAMESPACES 加 'mcp-servers'
  packages/bundle/web-app/cordis.patch.yml：组装 mcp-manager（host）+ ui-settings-mcp（client）

client 侧
  packages/client/ui-settings-mcp（@deepseek-ai/dsh-client-ui-settings-mcp，新包）
    · ctx.slots.register({ name: 'settings.plugins.tab', id: 'mcp', order: 5 }, Component)
```

New-package assembly follows the `packages/client/AGENTS.md` new-package checklist: the tsconfig aggregate faces (the host package joins the `tsconfig.host.json` references, the client package joins `tsconfig.client.json`), the `packages/bundle/web-app/cordis.patch.yml` row and `package.json` dependency, the client package's `dsh.client` manifest row, and the host package's `invariant` export and bilingual README gates.

## Data model (the `mcp-servers` namespace)

Schemastery schema: `z.dict(serverSchema)`, keyed by serverName, reusing the mcp-client constraint `/^[A-Za-z0-9_-]{1,32}$/`.

serverSchema fields (aligned with the mcp-client Config schema):

- `enabled: boolean`, default `true` — the panel switch writes exactly this
- `transport: 'stdio' | 'streamable-http'`
- stdio: `command: string`, `args?: string[]`, `env?: dict<string>` (`role('secret')`), `cwd?: string`
- streamable-http: `url: string`, `headers?: dict<string>` (`role('secret')`)
- `toolCallTimeoutMs?: number`, default 60000
- `failOnStartupError?: boolean`, default false

Constraints:

- env/headers are secret fields: describe redacts them off the wire, and writes go through path ops so a replace never clobbers secrets the caller has not seen.
- Duplicate-name protection has two layers. Write-time refusal: the `validate` option of `settings.register` (`packages/settings/settings/src/index.ts:61`) compares the settings dict keys against the declarative entries' serverNames before a write, and refuses the write on a collision — a user adding a duplicate server in the panel gets the refusal immediately. Load-time backstop: mcp-client keeps the set of active serverNames per `ctx.root` and fails a duplicate at load (`packages/mcp/mcp-client/src/index.ts:148-161`), catching hand-edited settings.yaml that bypassed the panel.

## mcp-manager behavior

- Startup: read the resolved config and run `ctx.plugin(McpClient, { serverName, transport, ... })` for every server whose `enabled !== false`.
- `settings/updated`: diff the before and after values — added → mount; removed or `enabled: false` → dispose; any other field change → dispose then remount. Every mount is cleaned up through its `ctx.effect()` scope.
- `mcpServers.list()` returns the union:
  - settings source: `{ serverName, source: 'settings', enabled, status: 'connecting' | 'ready' | 'failed', error? }`
  - declarative source: the manager reads `ctx.loader.entries()` directly and filters `entry.options.name === '@deepseek-ai/dsh-mcp-client'` (`entry.options.name` is the Loader entry's module name; `moduleName` is only the field name when restating the plugin-inventory payload, which this design does not reuse), projecting `{ serverName (from the entry config), transport, enabled: !entry.disabled, fiberPhase, source: 'declarative' }`; sensitive fields such as env/headers are never projected.
- Connection status tracking: mcp-client has no public status face (`connection.ts` keeps `startConnection`/`ready`/`dispose` internal), so the manager wraps minimal status tracking at the mount point (mounting → connecting; the awaitable fiber `ctx.plugin()` returns settling → ready; rejection or fiber failure → failed with an error summary), without changing mcp-client's public API.

## UI (ui-settings-mcp)

Tab order: plugin configuration (order 0) → **MCP (order 5)** → plugin list (order 10).

List page (structure follows the user-provided figure two, style aligned with the existing settings page):

- Top row: a search box on the right (reusing the plugin-inventory `type="search"` input pattern, filtering by serverName); beside it the rounded-square `+` button (`Button variant="outline"` plus an add icon, radius matching the existing cards).
- Server row: name, source badge (declarative rows show 「由配置文件管理」), a gear on the right (expands the inline edit form), and the enablement toggle. Declarative rows keep the switch and gear disabled with a hint.
- Empty state: with no servers, guidance copy plus the `+` entry.

Add page (the `+` switches to an in-page view):

- Fields: name (serverName validation), a segmented transport selector (stdio / streamable-http) rendering the matching fields (stdio: command/args/env/cwd; http: url/headers), and toolCallTimeoutMs.
- Client-side validation failures (duplicate, invalid serverName, missing command/url) show inline errors and send no RPC.
- Save: write the path op `{ op: 'set', path: [serverName], value }` through the settings scope.

Edit / delete:

- The gear expands an inline form (same fields as the add page); secret fields (env/headers) display redacted, and path-op writes never clobber unseen secrets.
- Delete: `{ op: 'unset', path: [serverName] }`.

Technical conventions (consistent with the existing cards): React 18 + CSS Modules + clsx; components/icons from `@deepseek-ai/dsh-client-ui-primitives`; state through `createSnapshotStore` / `SettingsScopeController`; bilingual `ctx.locale.register(NS, { zh, en })`.

## Data flow and error handling

- Reads: merge `ctx.settingsScope.bind({ namespace: 'mcp-servers' })` (the same pattern the cards use; `SettingsScopeController` drives `settings.describe` internally) with `ctx.remote.mcpServers.list()` for rendering; invalidations subscribe to `settings/document-updated` (handled by the existing `SettingsScopeBinder` logic) and connection status events.
- Writes: all go through the settings scope as path ops (which is `settings.mutate` plus `expectedRevision` underneath); `settings-conflict` is auto-reread by `SettingsScopeController` (the existing mechanism).
- One server's connection failure shows the failed state on that row only and never blocks the other servers.
- Reads and writes outside the api-proxy allowlist return `settings-not-exposed` (this design adds `mcp-servers` to `WEB_SETTINGS_NAMESPACES`).

## Test plan

- mcp-manager unit tests (`packages/mcp/mcp-manager/tests/`): schema validation, diff mount/unmount, enabled toggling, write-time duplicate refusal (validate), and the load-time backstop.
- ui-settings-mcp client unit tests (following `ui-settings-plugin-inventory/tests/browser-plugin.client.spec.tsx`): list rendering, search filtering, add-form validation.
- e2e `apps/web/tests/mcp-config.e2e.ts` (following `plugin-config.e2e.ts`): list rendering, search filtering, switch write-through to `$DSH_HOME/settings.yaml`, the add flow, declarative read-only rows; update the affected aria goldens.
- Add keyless snapshots per the repository testing policy (transcripts through a real runnable example).
- Non-trivial changes carry an Agent Note (`.agents/notes/`); update `docs/config-catalog.md` (the new `mcp-servers` namespace entry) and the new package READMEs.

## Explicitly excluded

- cordis.yml is not rewritten (declarative entries stay read-only display).
- `dsh-mcp-client`'s public API and one-instance-per-server model stay unchanged.
- No MCP server directory/marketplace (the search box filters already-configured servers only).
- mcp-client entries an agent preset mounts inline are absent from `ctx.loader.entries()` (`packages/preset/agent-presets/README.md:117`); such servers never appear among the declarative rows and stay outside the panel's management scope.
