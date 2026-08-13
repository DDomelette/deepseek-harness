# @deepseek-ai/dsh-mcp-manager

English | [中文](README.zh.md)

Settings-driven MCP server manager: owns the `mcp-servers` user-settings namespace that the Web settings panel edits, and projects the `cordis.yml`-declared (declarative) MCP servers read-only alongside the panel-managed roster.

## Usage

Mount the plugin alongside a settings provider and the Loader; it injects `settings` and `loader`:

```yaml
- name: '@deepseek-ai/dsh-mcp-manager'
```

The registered `mcp-servers` section is a dict keyed by serverName; every entry mirrors the `dsh-mcp-client` Config fields plus `enabled`. Writes apply live. A write is refused when a key violates the serverName pattern (`[A-Za-z0-9_-]{1,32}`) or names a server already declared in `cordis.yml` — the declarative and panel-managed rosters never overlap.

## Config

The `mcp-servers` section lives in the settings document (a namespace, not plugin Config):

| Field | Transport | Required | Description |
|---|---|---|---|
| (key) | both | yes | serverName: `[A-Za-z0-9_-]{1,32}`, unique across the panel-managed roster and every declarative server |
| `enabled` | both | no | Whether the entry is in effect (default `true`) |
| `transport` | both | yes | `"stdio"` or `"streamable-http"` |
| `command` | stdio | yes | Executable to spawn |
| `args` | stdio | no | Arguments passed to the command (default `[]`) |
| `env` | stdio | no | Extra env vars; `role('secret')`, redacted from every redacted `describe()` |
| `cwd` | stdio | no | Working directory for the child process (default `''`) |
| `url` | http | yes | MCP server URL |
| `headers` | http | no | Extra headers; `role('secret')` |
| `toolCallTimeoutMs` | both | no | Timeout per `callTool` invocation (default 60000) |
| `failOnStartupError` | both | no | Treat initial connection or tool synchronization failure as fatal for the entry (default `false`) |

## Declarative projection

`declarativeMcpServers(ctx)` projects the Loader entries that mount `dsh-mcp-client`: serverName and transport read from the entry config, enablement from the Loader, and the root Fiber phase. The panel renders these read-only next to the settings-managed roster; their lifecycle stays owned by `cordis.yml`.

## Relationship to dsh-mcp-client

`dsh-mcp-client` connects to one MCP server per plugin instance and registers its tools on `ctx.tools`. This package owns the settings namespace the panel writes and never connects to a server itself — every entry in effect is a `dsh-mcp-client` instance.

## Model Experience

### Managed MCP server tools

#### What the model sees

This package registers no prompt, tool, or result of its own; the model sees exactly what each mounted `dsh-mcp-client` instance registers under `mcp__<serverName>__<rawName>` for enabled `mcp-servers` entries.

#### Token effect

No token cost of its own; each mounted server's tool definitions cost what `dsh-mcp-client` documents per server.

#### KV Cache effect

No KV-cache effect of its own; adding, removing, or toggling an entry changes the mounted tool set exactly as editing the equivalent `cordis.yml` entry would.

## Known Limitations and Deferred Work

- **Writes do not hot-mount servers yet** — the namespace registers and validates, but the supervisor that mounts one `dsh-mcp-client` instance per enabled entry is a separate task; until then the section is inert configuration.
