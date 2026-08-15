# MCP settings page implementation plan

English | [中文](2026-08-13-mcp-settings-page.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an MCP tab to the "Plugins" page of the Web settings dialog: show the settings-managed and cordis.yml-declared MCP server lists, a hot-apply toggle, a search box, and "+" add/edit/delete, styled consistently with the existing settings page.

**Architecture:** A new host package `@deepseek-ai/dsh-mcp-manager` registers the `mcp-servers` settings namespace (`applies: 'live'`), watches it, diffs, and dynamically mounts/unmounts via `ctx.plugin(McpClient)`; the same package provides the Typert remote `mcpServers.list()` projecting both the settings and declarative sources. A new client package `@deepseek-ai/dsh-client-ui-settings-mcp` registers `settings.plugins.tab` (id `mcp`, order 5) and reads/writes via `ctx.settingsScope.bind({ namespace: 'mcp-servers' })`. The api-proxy allowlist adds `mcp-servers`.

**Tech Stack:** TypeScript ESM (strict), vendored Cordis, schemastery, React 18 + CSS Modules + clsx, `@deepseek-ai/dsh-client-ui-primitives`, vitest, Playwright e2e.

**Design document:** `docs/superpowers/specs/2026-08-13-mcp-settings-page-design.md` (approved; worktree branch `feat/mcp-settings-page`, working directory `.worktrees/mcp-settings-page`).

## Global Constraints

- All commands run under the worktree root `D:/Deepseek_Harness/.worktrees/mcp-settings-page`.
- Package names: `@deepseek-ai/dsh-mcp-manager` on the host side, `@deepseek-ai/dsh-client-ui-<name>` on the client side; `@deepseek-ai/cordis` is a peerDependency + devDependency of every package.
- ESM: `"type": "module"`; cross-package imports use package names, and local relative imports carry the `.ts` extension.
- serverName constraint `/^[A-Za-z0-9_-]{1,32}$/` (same as mcp-client); the settings namespace literal `mcp-servers` is branded via `settingsNamespace()`.
- Secret fields (`env`/`headers`) must use `role('secret')`; the wire face exposes a read-only redacted view, and writes go through path-ops.
- Do not modify any file in `packages/mcp/mcp-client`; do not rewrite cordis.yml.
- Every contribution goes through `ctx.effect()` / `ctx.on()`; misconfiguration fails loud; bilingual README + `README.i18n.yaml` pair (doc-sync gate).
- Product copy is Chinese, code comments are English; JSDoc complies with `verify-export-jsdoc` (`@param`/`@returns` for every exported symbol).
- Testing policy: client source is under the per-file 100% coverage gate (`pnpm run test:coverage`); the jsdom environment uses the `// @vitest-environment jsdom` pragma as the spec's first line.
- Commit message format follows the repository's existing history (e.g. `feat: ...`); commit once at the end of each Task.

---

### Task 1: host package scaffold + `mcp-servers` schema + settings registration (with duplicate-name rejection on write)

**Files:**
- Create: `packages/mcp/mcp-manager/package.json`
- Create: `packages/mcp/mcp-manager/tsconfig.json`
- Create: `packages/mcp/mcp-manager/src/schema.ts`
- Create: `packages/mcp/mcp-manager/src/declarative.ts`
- Create: `packages/mcp/mcp-manager/src/index.ts`
- Create: `packages/mcp/mcp-manager/src/invariant.ts`
- Create: `packages/mcp/mcp-manager/README.md`, `README.zh.md`, `README.i18n.yaml`
- Modify: `tsconfig.host.json` (insert into the references list in alphabetical order)
- Test: `packages/mcp/mcp-manager/tests/schema.spec.ts`, `packages/mcp/mcp-manager/tests/register.spec.ts`

**Interfaces:**
- Consumes: `settingsNamespace` / `SettingsRegisterOptions` (`@deepseek-ai/dsh-settings`); `ctx.loader.entries()` (the Context merge from `@deepseek-ai/cordis-plugin-loader`).
- Produces (depended on by later Tasks):
  - `MCP_SERVERS_NS: 'mcp-servers'` (`schema.ts`)
  - `SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/` (`schema.ts`)
  - `McpServersSchema: z<McpServersSection>`, `McpServerEntryConfig` (the fully resolved type of `enabled/transport/command?/args?/env?/cwd?/url?/headers?/toolCallTimeoutMs/failOnStartupError`, where every optional field is guaranteed a value after parsing), `McpServersSection = Record<string, McpServerEntryConfig>` (`schema.ts`)
  - `declarativeMcpServers(ctx: Context): DeclarativeMcpServer[]`, where `DeclarativeMcpServer = { serverName: string; transport: 'stdio' | 'streamable-http'; enabled: boolean; fiberPhase: PluginFiberPhaseLike }` (`declarative.ts`; reused by Task 3's gateway)
  - Plugin exports `name = 'mcp-manager'`, `inject`, `apply` (`index.ts`)

- [ ] **Step 1: Write a failing schema test** `packages/mcp/mcp-manager/tests/schema.spec.ts`

```ts ignore-check
import { describe, expect, it } from 'vitest'
import { MCP_SERVERS_NS, McpServersSchema, SERVER_NAME_PATTERN } from '../src/schema.ts'

describe('mcp-servers schema', () => {
  it('applies stdio defaults', () => {
    const value = McpServersSchema({
      alpha: { transport: 'stdio', command: 'memorix' },
    })
    expect(value.alpha).toMatchObject({
      enabled: true,
      args: [],
      env: {},
      cwd: '',
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    })
  })

  it('applies streamable-http defaults and keeps headers secret-roled', () => {
    const value = McpServersSchema({
      docs: { transport: 'streamable-http', url: 'https://example.com/mcp' },
    })
    expect(value.docs).toMatchObject({ enabled: true, headers: {} })
  })

  it('rejects an entry missing its transport-required field', () => {
    expect(() => McpServersSchema({ broken: { transport: 'stdio' } })).toThrow()
    expect(() => McpServersSchema({ broken: { transport: 'streamable-http' } })).toThrow()
  })

  it('exposes the shared serverName pattern and namespace literal', () => {
    expect(MCP_SERVERS_NS).toBe('mcp-servers')
    expect(SERVER_NAME_PATTERN.test('node_repl')).toBe(true)
    expect(SERVER_NAME_PATTERN.test('has space')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run packages/mcp/mcp-manager/tests/schema.spec.ts` Expected: FAIL (module does not exist)

- [ ] **Step 3: Implement the schema** `packages/mcp/mcp-manager/src/schema.ts`

```ts ignore-check
/**
 * Settings schema for the `mcp-servers` namespace: a dict keyed by serverName
 * whose entries mirror the `dsh-mcp-client` Config fields plus `enabled`.
 *
 * @module @deepseek-ai/dsh-mcp-manager
 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owning the panel-managed MCP server roster. */
export const MCP_SERVERS_NS = 'mcp-servers'

/** Valid serverName, identical to the mcp-client constraint. */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** Default per-tool-call timeout, identical to mcp-client. */
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/** Fully resolved settings entry for one stdio MCP server. */
export interface McpStdioEntry {
  enabled: boolean
  transport: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
  toolCallTimeoutMs: number
  failOnStartupError: boolean
}

/** Fully resolved settings entry for one Streamable HTTP MCP server. */
export interface McpHttpEntry {
  enabled: boolean
  transport: 'streamable-http'
  url: string
  headers: Record<string, string>
  toolCallTimeoutMs: number
  failOnStartupError: boolean
}

/** Fully resolved settings entry for one MCP server. */
export type McpServerEntryConfig = McpStdioEntry | McpHttpEntry

/** Resolved `mcp-servers` section: dict keyed by serverName. */
export type McpServersSection = Record<string, McpServerEntryConfig>

const stdioEntry = z.object({
  enabled: z.boolean().default(true),
  transport: z.const('stdio'),
  command: z.string().required(),
  args: z.array(String).default([]),
  env: z.dict(String).default({}).role('secret'),
  cwd: z.string().default(''),
  toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
  failOnStartupError: z.boolean().default(false),
})

const httpEntry = z.object({
  enabled: z.boolean().default(true),
  transport: z.const('streamable-http'),
  url: z.string().required(),
  headers: z.dict(String).default({}).role('secret'),
  toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
  failOnStartupError: z.boolean().default(false),
})

/** Schema of one dict entry; the key carries the serverName. */
export const McpServerEntrySchema = z.union([stdioEntry, httpEntry]) as unknown as z<McpServerEntryConfig>

/** Schema of the whole `mcp-servers` section. */
export const McpServersSchema = z.dict(McpServerEntrySchema) as unknown as z<McpServersSection>
```

- [ ] **Step 4: Run to confirm passing**

Run: `pnpm vitest run packages/mcp/mcp-manager/tests/schema.spec.ts` Expected: PASS

- [ ] **Step 5: Write a failing registration/duplicate-name-rejection test** `packages/mcp/mcp-manager/tests/register.spec.ts`

```ts ignore-check
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { MemorySettings } from '@deepseek-ai/dsh-settings/tests/memory.ts' // 若该路径未导出，用相对路径引 packages/settings/settings/tests/memory.ts 同款最小 provider（见其 tests/settings.spec.ts:53-59 的 boot 模式）
import * as McpManager from '../src/index.ts'
import { MCP_SERVERS_NS } from '../src/schema.ts'

/** Minimal loader face: the plugin only ever reads entries(). */
function fakeLoader(entries: Array<{ name: string; config?: unknown; disabled?: boolean }>) {
  return {
    entries: () => entries.map(entry => ({
      id: `test/${entry.name}`,
      options: { name: entry.name, config: entry.config, group: false },
      disabled: entry.disabled ?? false,
      fiber: undefined,
    })),
  }
}

async function boot(loaderEntries: Array<{ name: string; config?: unknown; disabled?: boolean }> = []) {
  const ctx = new Context()
  await ctx.plugin(MemorySettings)
  ctx.provide('loader', fakeLoader(loaderEntries) as never, true)
  await ctx.plugin(McpManager)
  return ctx
}

describe('mcp-manager settings registration', () => {
  it('registers the mcp-servers namespace with live apply', async () => {
    const ctx = await boot()
    const described = ctx.settings.describe({})
    const view = described.find(entry => entry.ns === (MCP_SERVERS_NS as SettingsNamespace))
    expect(view?.applies).toBe('live')
  })

  it('refuses a write whose serverName collides with a declarative entry', async () => {
    const ctx = await boot([{
      name: '@deepseek-ai/dsh-mcp-client',
      config: { serverName: 'memorix', transport: 'stdio' },
    }])
    await expect(ctx.settings.update(settingsNamespaceLike(MCP_SERVERS_NS), {
      memorix: { transport: 'stdio', command: 'x' },
    })).rejects.toThrow(/memorix/)
  })

  it('refuses a write whose key violates the serverName pattern', async () => {
    const ctx = await boot()
    await expect(ctx.settings.update(settingsNamespaceLike(MCP_SERVERS_NS), {
      'has space': { transport: 'stdio', command: 'x' },
    })).rejects.toThrow(/has space/)
  })
})
```

Here `settingsNamespaceLike` is `settingsNamespace` (imported from `@deepseek-ai/dsh-settings`); the `ctx.settings.update` signature is `update(ns, patch)` — the implementer adjusts the call shape to match the public `SettingsProvider` signature in `packages/settings/settings/src/index.ts`.

- [ ] **Step 6: Run to confirm failure**

Run: `pnpm vitest run packages/mcp/mcp-manager/tests/register.spec.ts` Expected: FAIL

- [ ] **Step 7: Implement the declarative projection and plugin registration**

`packages/mcp/mcp-manager/src/declarative.ts`:

```ts ignore-check
/** Projection of cordis.yml-declared mcp-client Loader entries. */

import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'

/** Module specifier of the mcp-client plugin, matched against `entry.options.name`. */
export const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/** Lifecycle phase of one declarative entry's root Fiber, mirroring plugin-inventory. */
export type DeclarativeFiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

/** Panel-visible projection of one cordis.yml-declared MCP server. */
export interface DeclarativeMcpServer {
  /** serverName read from the entry's plugin config. */
  readonly serverName: string
  /** Transport read from the entry's plugin config. */
  readonly transport: 'stdio' | 'streamable-http'
  /** Effective Loader enablement (`!entry.disabled`). */
  readonly enabled: boolean
  /** Root Fiber phase, or null when the entry has no live root Fiber. */
  readonly fiberPhase: DeclarativeFiberPhase
}

// FIBER_PHASE 映射表照抄 packages/host/plugin-inventory/src/index.ts:22-40
// （FiberState 是跨包 const enum，需要 runtime mirror）。

/**
 * Project the Loader entries that mount dsh-mcp-client. Entries whose config
 * lacks a readable serverName/transport are skipped — a malformed declarative
 * entry fails at its own fiber load, not here.
 * @param ctx - host context carrying the loader service.
 * @returns declarative MCP servers in Loader order.
 */
export function declarativeMcpServers(ctx: Context): DeclarativeMcpServer[] {
  const result: DeclarativeMcpServer[] = []
  for (const entry of ctx.loader.entries()) {
    if (entry.options.group) continue
    if (entry.options.name !== MCP_CLIENT_MODULE) continue
    const config = entry.options.config as { serverName?: unknown; transport?: unknown } | undefined
    if (typeof config?.serverName !== 'string') continue
    if (config.transport !== 'stdio' && config.transport !== 'streamable-http') continue
    result.push({
      serverName: config.serverName,
      transport: config.transport,
      enabled: !entry.disabled,
      fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
    })
  }
  return result
}
```

`packages/mcp/mcp-manager/src/index.ts`:

```ts ignore-check
/**
 * MCP server manager: owns the `mcp-servers` settings namespace, hot-mounts
 * one dsh-mcp-client instance per enabled entry, and projects declarative
 * (cordis.yml) servers read-only alongside them.
 *
 * @module @deepseek-ai/dsh-mcp-manager
 */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { declarativeMcpServers } from './declarative.ts'
import { MCP_SERVERS_NS, McpServersSchema, SERVER_NAME_PATTERN } from './schema.ts'
import type { McpServersSection } from './schema.ts'

export * from './schema.ts'
export * from './declarative.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-manager'

/** Services required by this plugin. */
export const inject = ['settings', 'loader']

/**
 * Register the namespace, then wire the supervisor (Task 2 inserts the
 * supervisor between registration and watch).
 * @param ctx - host context carrying settings and loader services.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings', 'loader'], (sctx) => {
    sctx.settings.register(settingsNamespace(MCP_SERVERS_NS), McpServersSchema, {
      applies: 'live',
      validate: (section: McpServersSection) => {
        const declarative = new Set(declarativeMcpServers(sctx).map(server => server.serverName))
        for (const key of Object.keys(section)) {
          if (!SERVER_NAME_PATTERN.test(key)) {
            throw new Error(`mcp-servers: serverName "${key}" must match ${String(SERVER_NAME_PATTERN)}`)
          }
          if (declarative.has(key)) {
            throw new Error(`mcp-servers: serverName "${key}" is already declared in cordis.yml — pick a unique name`)
          }
        }
      },
    })
  })
}
```

- [ ] **Step 8: Package scaffold**

`packages/mcp/mcp-manager/package.json` (template: `packages/host/plugin-inventory/package.json`; the `./typert` and `./remote` exports are added only in Task 3, not in this Task):

```json
{
  "name": "@deepseek-ai/dsh-mcp-manager",
  "description": "Settings-driven MCP server manager: hot-mounts dsh-mcp-client instances from the mcp-servers namespace",
  "version": "0.1.0-rc.5",
  "publishConfig": { "access": "public" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deepseek-ai/deepseek-harness.git",
    "directory": "packages/mcp/mcp-manager"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./invariant": { "types": "./lib/types/invariant.d.ts", "default": "./lib/invariant.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "lib/invariant.js", "lib/types/**/*.d.ts"],
  "license": "MIT",
  "dependencies": {
    "@deepseek-ai/schemastery": "workspace:^",
    "zod": "^4.4.3"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "workspace:^",
    "@deepseek-ai/cordis-plugin-loader": "workspace:^",
    "@deepseek-ai/dsh-invariants": "workspace:^",
    "@deepseek-ai/dsh-mcp-client": "workspace:^",
    "@deepseek-ai/dsh-settings": "workspace:^"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "workspace:^",
    "@deepseek-ai/cordis-plugin-loader": "workspace:^",
    "@deepseek-ai/dsh-invariants": "workspace:^",
    "@deepseek-ai/dsh-mcp-client": "workspace:^",
    "@deepseek-ai/dsh-settings": "workspace:^"
  }
}
```

`packages/mcp/mcp-manager/tsconfig.json` (template: `packages/host/plugin-inventory/tsconfig.json`, references follow the actual dependencies: `vendor/cordis`, `vendor/loader`, `../../settings/settings`, `../../runtime-diagnostics/invariants`, `../mcp-client`).

`packages/mcp/mcp-manager/src/invariant.ts`: copy the structure of `packages/host/plugin-inventory/src/invariant.ts`, change `PACKAGE_NAME` to `'@deepseek-ai/dsh-mcp-manager'` and `name = 'mcp-manager-invariant'`; the invariant install body asserts "settings-managed serverNames have no intersection with declarative ones" (check `declarativeMcpServers` and the registered value; if registration has not happened, write an explained empty companion per the packages/AGENTS.md rules).

`tsconfig.host.json`: add `{ "path": "./packages/mcp/mcp-manager" }` to the `references` array in the existing sorted order.

README.md / README.zh.md / README.i18n.yaml: follow the bilingual structure and i18n.yaml format of `packages/mcp/mcp-client/README.md`, covering: capability (settings namespace + hot mounting + read-only declarative projection), config table, and the relationship to mcp-client.

- [ ] **Step 9: Install dependencies and run tests**

Run: `pnpm install && pnpm vitest run packages/mcp/mcp-manager` Expected: PASS

- [ ] **Step 10: Type check**

Run: `pnpm run build:lib:host` Expected: compiles

- [ ] **Step 11: Commit**

```bash
git add packages/mcp/mcp-manager tsconfig.host.json pnpm-lock.yaml
git commit -m "feat(mcp-manager): scaffold package with mcp-servers settings namespace"
```

---

### Task 2: dynamic-mount supervisor (diff + ctx.plugin hot mounting + status tracking)

**Files:**
- Create: `packages/mcp/mcp-manager/src/supervisor.ts`
- Modify: `packages/mcp/mcp-manager/src/index.ts` (wire in the supervisor)
- Test: `packages/mcp/mcp-manager/tests/supervisor.spec.ts`, `packages/mcp/mcp-manager/tests/mount.spec.ts`

**Interfaces:**
- Consumes: Task 1's `McpServersSection` and `McpServerEntryConfig`; the namespace plugin object of `@deepseek-ai/dsh-mcp-client` (`import * as McpClient from '@deepseek-ai/dsh-mcp-client'`, `ctx.plugin(McpClient, config)` returns an awaitable `Fiber`, `fiber.dispose(): Promise<void>`).
- Produces:
  - `planServerDiff(prev: McpServersSection, next: McpServersSection): ServerAction[]`, `ServerAction = { kind: 'mount' | 'dispose' | 'remount'; serverName: string }` (pure function)
  - `McpServerSupervisor`: `sync(next: McpServersSection): void`, `list(): ManagedServerState[]`, `dispose(): Promise<void>`; `ManagedServerState = { serverName: string; enabled: boolean; status: 'connecting' | 'ready' | 'failed'; error?: string }`

- [ ] **Step 1: Write a failing diff pure-function test** `tests/supervisor.spec.ts`

```ts ignore-check
import { describe, expect, it } from 'vitest'
import { planServerDiff } from '../src/supervisor.ts'
import type { McpServersSection } from '../src/schema.ts'

const stdio = (over: object = {}) => ({ enabled: true, transport: 'stdio' as const, command: 'x', args: [], env: {}, cwd: '', toolCallTimeoutMs: 60_000, failOnStartupError: false, ...over })

describe('planServerDiff', () => {
  it('mounts added enabled entries only', () => {
    const next: McpServersSection = { a: stdio(), b: stdio({ enabled: false }) }
    expect(planServerDiff({}, next)).toEqual([{ kind: 'mount', serverName: 'a' }])
  })

  it('disposes removed or disabled entries', () => {
    const prev: McpServersSection = { a: stdio(), b: stdio() }
    expect(planServerDiff(prev, { a: stdio() })).toEqual([{ kind: 'dispose', serverName: 'b' }])
    expect(planServerDiff(prev, { a: stdio(), b: stdio({ enabled: false }) }))
      .toEqual([{ kind: 'dispose', serverName: 'b' }])
  })

  it('remounts on config change, ignores identical entries', () => {
    const prev: McpServersSection = { a: stdio(), b: stdio() }
    const next: McpServersSection = { a: stdio(), b: stdio({ command: 'y' }) }
    expect(planServerDiff(prev, next)).toEqual([{ kind: 'remount', serverName: 'b' }])
    expect(planServerDiff(prev, { ...prev })).toEqual([])
  })

  it('treats re-enable as mount', () => {
    const prev: McpServersSection = { a: stdio({ enabled: false }) }
    expect(planServerDiff(prev, { a: stdio() })).toEqual([{ kind: 'mount', serverName: 'a' }])
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run packages/mcp/mcp-manager/tests/supervisor.spec.ts` Expected: FAIL

- [ ] **Step 3: Implement the supervisor** `src/supervisor.ts`

```ts ignore-check
/**
 * Hot-mount supervisor: diffs consecutive `mcp-servers` sections and mounts or
 * disposes one dsh-mcp-client fiber per enabled entry. Status tracking wraps
 * the mount point only — mcp-client's public API stays untouched.
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import type { McpServerEntryConfig, McpServersSection } from './schema.ts'

/** One reconciler action between two sections. */
export interface ServerAction {
  readonly kind: 'mount' | 'dispose' | 'remount'
  readonly serverName: string
}

/** Panel-visible state of one settings-managed server. */
export interface ManagedServerState {
  readonly serverName: string
  readonly enabled: boolean
  readonly status: 'connecting' | 'ready' | 'failed'
  readonly error?: string
}

/**
 * Diff two resolved sections into mount/dispose/remount actions. An entry
 * whose `enabled` flips false becomes `dispose`; any other field change on a
 * live entry becomes `remount`. Equality is deep over the resolved entry.
 * @param prev - previously applied section.
 * @param next - newly resolved section.
 * @returns actions in stable key order (disposes before mounts).
 */
export function planServerDiff(prev: McpServersSection, next: McpServersSection): ServerAction[] {
  const actions: ServerAction[] = []
  for (const key of Object.keys(prev)) {
    const before = prev[key]!
    const after = next[key]
    if (after === undefined || !after.enabled) {
      if (before.enabled) actions.push({ kind: 'dispose', serverName: key })
      continue
    }
    if (!before.enabled) continue // handled as mount below
    if (JSON.stringify(before) !== JSON.stringify(after)) actions.push({ kind: 'remount', serverName: key })
  }
  for (const key of Object.keys(next)) {
    const after = next[key]!
    if (!after.enabled) continue
    const before = prev[key]
    if (before === undefined || !before.enabled) actions.push({ kind: 'mount', serverName: key })
  }
  return actions
}

/**
 * Owns the live mcp-client fibers for the settings-managed roster. All fibers
 * are children of the constructing context; `dispose()` tears the roster down
 * in reverse mount order.
 */
export class McpServerSupervisor {
  private readonly mounts = new Map<string, { fiber: Fiber; state: ManagedServerState }>()
  private section: McpServersSection = {}

  /**
   * @param ctx - host context the mcp-client fibers parent onto.
   */
  constructor(private readonly ctx: Context) {}

  /**
   * Reconcile live mounts against a newly resolved section.
   * @param next - newly resolved `mcp-servers` section.
   */
  sync(next: McpServersSection): void {
    for (const action of planServerDiff(this.section, next)) {
      if (action.kind !== 'mount') void this.unmount(action.serverName)
      if (action.kind !== 'dispose') this.mount(action.serverName, next[action.serverName]!)
    }
    this.section = next
  }

  /** @returns current per-server state, settings entries first in key order. */
  list(): ManagedServerState[] {
    return [...this.mounts.values()].map(mount => mount.state)
  }

  /** @returns settlement after every live fiber is disposed. */
  async dispose(): Promise<void> {
    for (const serverName of [...this.mounts.keys()].reverse()) await this.unmount(serverName)
  }

  private mount(serverName: string, entry: McpServerEntryConfig): void {
    const state: ManagedServerState = { serverName, enabled: true, status: 'connecting' }
    const { enabled: _enabled, ...config } = entry
    const fiber = this.ctx.plugin(McpClient, { ...config, serverName })
    this.mounts.set(serverName, { fiber, state })
    // ctx.plugin returns an awaitable Fiber: settlement means the initial
    // connection plus tool discovery finished; rejection means startup failed.
    void Promise.resolve(fiber).then(
      () => { state.status = 'ready' },
      (error: unknown) => {
        state.status = 'failed'
        state.error = error instanceof Error ? error.message : String(error)
      },
    )
    this.mounts.set(serverName, { fiber, state })
  }

  private async unmount(serverName: string): Promise<void> {
    const mount = this.mounts.get(serverName)
    if (!mount) return
    this.mounts.delete(serverName)
    await mount.fiber.dispose()
  }
}
```

Note: disabled settings entries must also appear in `list()` (the panel shows them but marks their status disabled) — when implementing, change `list()` to iterate `this.section`: enabled ones read the mounts state, disabled ones return `{ serverName, enabled: false, status: 'failed' }`... no, the `status` semantics become `'connecting' | 'ready' | 'failed'`, and disabled entries report no status — see Task 3's list entry type (`status: McpServerStatus | null`, `null` for disabled). The implementer aligns to the Task 3 type.

- [ ] **Step 4: Run the diff test to confirm passing**

Run: `pnpm vitest run packages/mcp/mcp-manager/tests/supervisor.spec.ts` Expected: PASS

- [ ] **Step 5: Write the mount integration test** `tests/mount.spec.ts`

Use the existing stdio fixture from `packages/mcp/mcp-client/tests/fixture-server.ts` (`command: process.execPath`, following the server-start approach in `mcp-client.e2e.ts:73`):

```ts ignore-check
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as McpManager from '../src/index.ts'
// fixture 路径与启动参数照 packages/mcp/mcp-client/tests/mcp-client.e2e.ts:60-80

describe('mcp-manager mounting', () => {
  it('mounts an enabled server and registers its tools', async () => {
    // boot（MemorySettings + 空假 loader + McpManager，同 register.spec.ts）
    // ctx.settings.update(ns, { echo: { transport: 'stdio', command: process.execPath, args: [fixturePath] } })
    // 等 supervisor 状态 ready → ctx.tools 含 mcp__echo__ 前缀工具
  })

  it('disposes on enabled: false and remounts on command change', async () => {
    // 同上挂载后：update enabled:false → 工具注销、list() 行 enabled false/status null
    // 再 update command 变更 → 旧工具先注销、新工具后注册（remount 顺序）
  })

  it('tears down the whole roster on dispose', async () => {
    // supervisor.dispose()（或卸载 mcp-manager 插件）→ 全部 mcp__ 工具注销
  })
})
```

Inline the complete assertion code in each it (empty implementations are not allowed); the tool-existence assertions follow how `packages/mcp/mcp-client/tests/apply.spec.ts` reads `ctx.tools`.

- [ ] **Step 6: Run to confirm failure (supervisor not yet wired into index.ts)**

Run: `pnpm vitest run packages/mcp/mcp-manager/tests/mount.spec.ts` Expected: FAIL

- [ ] **Step 7: Wire into index.ts**

Inside `apply`'s `ctx.inject` callback, after registration:

```ts ignore-check
const scope = sctx.settings.register(/* …Task 1 内容… */)
const supervisor = new McpServerSupervisor(sctx)
supervisor.sync(scope.get())
sctx.effect(() => scope.watch((next) => { supervisor.sync(next) }), 'mcp-manager: settings watch')
sctx.effect(() => () => supervisor.dispose(), 'mcp-manager: roster teardown')
```

- [ ] **Step 8: Run all mcp-manager tests to confirm passing**

Run: `pnpm vitest run packages/mcp/mcp-manager` Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/mcp/mcp-manager
git commit -m "feat(mcp-manager): hot-mount supervisor over the mcp-servers namespace"
```

---

### Task 3: `mcpServers.list()` Typert remote service

**Files:**
- Create: `packages/mcp/mcp-manager/src/types.ts`
- Create: `packages/mcp/mcp-manager/src/gateway.ts`
- Modify: `packages/mcp/mcp-manager/src/index.ts` (default-export the gateway; follow plugin-inventory's `export default PluginInventoryGateway`)
- Modify: `packages/mcp/mcp-manager/package.json` (add `./typert` and `./remote` exports and `files` entries, peer/dev dependencies `@deepseek-ai/dsh-typert-protocol`, `@deepseek-ai/dsh-brand`)
- Modify: `packages/mcp/mcp-manager/tsconfig.json` (add `../../typert/protocol`, `../../util/brand` to references)
- Modify: `packages/bundle/web-app/cordis.patch.yml` (add the mcp-manager entry in the host section)
- Modify: `packages/bundle/web-app/package.json` (add `@deepseek-ai/dsh-mcp-manager` to dependencies)
- Test: `packages/mcp/mcp-manager/tests/gateway.spec.ts`

**Interfaces:**
- Consumes: Task 1's `declarativeMcpServers`; Task 2's `McpServerSupervisor.list()`; `TypertRemoteService`/`Remote` (`@deepseek-ai/dsh-typert-protocol`).
- Produces (depended on by client Task 5):
  - `McpServerStatus = 'connecting' | 'ready' | 'failed'` (`types.ts`)
  - `McpServerListEntry = { serverName: string; transport: 'stdio' | 'streamable-http'; source: 'settings' | 'declarative'; enabled: boolean; status: McpServerStatus | null; error?: string }`
  - `McpServerSnapshot = { entries: readonly McpServerListEntry[] }`
  - `McpServersGateway extends TypertRemoteService`, `@Remote('list') list(): McpServerSnapshot`; service name `'mcpServers'`

- [ ] **Step 1: Write a failing gateway test** `tests/gateway.spec.ts`

```ts ignore-check
// 装配：host app + 假 loader（一条 declarative mcp-client 条目）+ settings 注册
// + supervisor 挂一台 settings server。断言 list() 返回并集：
// - settings 行：source 'settings'、enabled、status 来自 supervisor
// - declarative 行：source 'declarative'、status 为 null、fiberPhase 投影为
//   enabled 字段（!entry.disabled）
// - 条目不含 env/headers 字段（敏感字段不投影）
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run packages/mcp/mcp-manager/tests/gateway.spec.ts` Expected: FAIL

- [ ] **Step 3: Implement the types and gateway**

`src/types.ts`:

```ts ignore-check
/** Wire types of the mcpServers Remote face. */

/** Connection state of one settings-managed MCP server mount. */
export type McpServerStatus = 'connecting' | 'ready' | 'failed'

/** One MCP server row exposed to the trusted Web client. */
export interface McpServerListEntry {
  /** Stable local namespace (`mcp__<serverName>__<tool>`). */
  readonly serverName: string
  /** Transport the entry connects over. */
  readonly transport: 'stdio' | 'streamable-http'
  /** Managing plane: settings panel or cordis.yml declaration. */
  readonly source: 'settings' | 'declarative'
  /** Effective enablement; declarative rows mirror `!entry.disabled`. */
  readonly enabled: boolean
  /** Live mount status; null for disabled or declarative rows. */
  readonly status: McpServerStatus | null
  /** Startup failure summary when status is 'failed'. */
  readonly error?: string
}

/** Point-in-time roster returned by the mcpServers Remote. */
export interface McpServerSnapshot {
  readonly entries: readonly McpServerListEntry[]
}
```

`src/gateway.ts`:

```ts ignore-check
/** Remote-only service exposing the MCP server roster to trusted clients. */

import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from 'zod'
import { declarativeMcpServers } from './declarative.ts'
import type { McpServerSnapshot, McpServerListEntry } from './types.ts'
import type { McpServerSupervisor } from './supervisor.ts'

export type * from './types.ts'

/** Remote-only service over the manager's roster plus declarative entries. */
export class McpServersGateway extends TypertRemoteService {
  static inject = ['settings', 'loader']

  constructor(ctx: Context) {
    super(ctx, 'mcpServers')
  }

  /**
   * Merge the settings-managed roster with declarative Loader entries on every
   * call; neither side is cached, so the snapshot never goes stale.
   * @returns current MCP server rows, settings entries first.
   */
  @Remote('list')
  list(): McpServerSnapshot {
    // supervisor 由 index.ts 的 apply 挂到 ctx.root 的 package-private 注册处
    // （WeakMap<Context, McpServerSupervisor>，与 mcp-client 的 activeServerNames
    // 同款模式），gateway 从这里取；缺失时 settings 行为空。
    const entries: McpServerListEntry[] = []
    for (const state of supervisorFor(this.ctx)?.list() ?? []) {
      entries.push({
        serverName: state.serverName,
        transport: transportOf(state.serverName), // 从 supervisor 持有的 section 读
        source: 'settings',
        enabled: state.enabled,
        status: state.enabled ? state.status : null,
        ...(state.error === undefined ? {} : { error: state.error }),
      })
    }
    for (const server of declarativeMcpServers(this.ctx)) {
      entries.push({
        serverName: server.serverName,
        transport: server.transport,
        source: 'declarative',
        enabled: server.enabled,
        status: null,
      })
    }
    return { entries }
  }
}

export default McpServersGateway
```

Implementer note: the concrete form of `supervisorFor`/`transportOf` depends on how the supervisor holds the section — store `McpServersSection` on the supervisor (`sync` already assigns `this.section`), and having `list()` produce rows that include transport directly is simpler than a second lookup. The implementation may extend `ManagedServerState` with a `transport` field and update Task 2's code and tests accordingly.

Also note: mcp-client entries mounted inline by agent-preset are not in `ctx.loader.entries()` (`packages/preset/agent-presets/README.md:117`), so this projection naturally excludes them — this is a design decision (the spec's "explicit exclusion"), not an omission; the gateway's JSDoc states this.

- [ ] **Step 4: Wire into index.ts and generate typert artifacts**

index.ts: `export type * from './types.ts'`, `export { McpServersGateway }`, `export default McpServersGateway`; inside `apply`, store the supervisor in a module-level `WeakMap<Context, McpServerSupervisor>` (keyed by `ctx.root`) for the gateway to read.

package.json adds the export pair (following plugin-inventory):

```json
"./typert": { "types": "./lib/typert.host.d.ts", "default": "./lib/typert.host.js" },
"./remote": { "types": "./lib/typert.remote-client.d.ts", "default": "./lib/typert.remote-client.js" }
```

`files` adds `"lib/typert.host.js"`, `"lib/typert.host.d.ts"`, `"lib/typert.remote-client.js"`, `"lib/typert.remote-client.d.ts"`.

Run: `pnpm install && pnpm run build:lib:host` (tsdown's typertPlugin auto-scans `TypertRemoteService` subclasses and generates artifacts) Expected: `packages/mcp/mcp-manager/lib/typert.host.js` and `lib/typert.remote-client.js` are generated

- [ ] **Step 5: web-app assembly**

`packages/bundle/web-app/cordis.patch.yml`: after the plugin-inventory entry add:

```yaml
    # Settings-driven MCP server manager and its read-only roster Remote.
    - id: mcp-manager
      name: '@deepseek-ai/dsh-mcp-manager'
```

`packages/bundle/web-app/package.json`: add `"@deepseek-ai/dsh-mcp-manager": "workspace:^"` to dependencies.

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run packages/mcp/mcp-manager` Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/mcp/mcp-manager packages/bundle/web-app
git commit -m "feat(mcp-manager): mcpServers.list remote over settings and declarative rosters"
```

---

### Task 4: api-proxy allowlist + api-remotes aggregation

**Files:**
- Modify: `packages/host/apiproxy/src/api-proxy.ts:127-130` (`WEB_SETTINGS_NAMESPACES`)
- Modify: `packages/api/remotes/src/client/index.ts` (mount + type re-exports)
- Modify: `packages/api/remotes/package.json` (add `@deepseek-ai/dsh-mcp-manager` to dependencies)
- Test: `packages/host/apiproxy/tests/api-proxy-config.spec.ts` (add a case)

**Interfaces:**
- Consumes: Task 3's `./remote` and `./types` exports.
- Produces: `ctx.remote.mcpServers.list()` is available on the client side; `settings.describe/mutate` accept `mcp-servers`.

- [ ] **Step 1: Write a failing allowlist test**

Append to `api-proxy-config.spec.ts` (following the "serves model-provider and explicitly allowlisted Web namespaces only" case starting at L324):

```ts ignore-check
it('exposes the mcp-servers namespace to the Web client', async () => {
  const ctx = await harness()
  ctx.settings.register(settingsNamespace('mcp-servers'), z.dict(z.object({
    enabled: z.boolean().default(true),
  })))
  const api = createApiProxy(ctx, DEFAULTS)
  const described = expectOk(await api.settings.describe(request({})))
  expect(described.namespaces.some(view => view.ns === 'mcp-servers')).toBe(true)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run packages/host/apiproxy/tests/api-proxy-config.spec.ts -t mcp-servers` Expected: FAIL (`settings-not-exposed` or namespaces does not contain it)

- [ ] **Step 3: Add the allowlist and aggregation**

In `api-proxy.ts`, add `'mcp-servers'` to the `WEB_SETTINGS_NAMESPACES` array and update its JSDoc (L117-126, noting that the MCP panel is one section of that page).

`packages/api/remotes/src/client/index.ts`: follow pluginInventory's three-part pattern —

```ts ignore-check
import mcpServersRemote from '@deepseek-ai/dsh-mcp-manager/remote'
export type { McpServerListEntry, McpServerSnapshot, McpServerStatus } from '@deepseek-ai/dsh-mcp-manager/types'
export type {} from '@deepseek-ai/dsh-mcp-manager/remote'
// mount 列表：commandsRemote, goalsRemote, dynamicRemote, pluginInventoryRemote, messageFeedbackRemote, mcpServersRemote
```

`packages/api/remotes/package.json`: add `"@deepseek-ai/dsh-mcp-manager": "workspace:^"` to dependencies.

- [ ] **Step 4: Run to confirm passing**

Run: `pnpm install && pnpm vitest run packages/host/apiproxy/tests/api-proxy-config.spec.ts` Expected: PASS

- [ ] **Step 5: Type check**

Run: `pnpm run build:lib:host && pnpm run typecheck:contracts-ready` Expected: compiles

- [ ] **Step 6: Commit**

```bash
git add packages/host/apiproxy packages/api/remotes
git commit -m "feat(apiproxy): expose the mcp-servers namespace and mcpServers remote to the Web client"
```

---

### Task 5: client package scaffold + MCP tab list view (search + toggles + read-only declarative rows)

**Files:**
- Create: `packages/client/ui-settings-mcp/package.json`
- Create: `packages/client/ui-settings-mcp/tsconfig.json`
- Create: `packages/client/ui-settings-mcp/tsdown.config.ts`
- Create: `packages/client/ui-settings-mcp/src/index.ts` (empty node-half apply)
- Create: `packages/client/ui-settings-mcp/src/invariant.ts`
- Create: `packages/client/ui-settings-mcp/src/css-modules.d.ts`
- Create: `packages/client/ui-settings-mcp/src/client/index.ts`
- Create: `packages/client/ui-settings-mcp/src/client/locales.ts`
- Create: `packages/client/ui-settings-mcp/src/client/mcp-tab-controller.ts`
- Create: `packages/client/ui-settings-mcp/src/client/McpSettingsTab.tsx`
- Create: `packages/client/ui-settings-mcp/src/client/McpSettingsTab.module.css`
- Create: `packages/client/ui-settings-mcp/README.md`
- Modify: `tsconfig.client.json` (add `./packages/client/ui-settings-mcp` to references)
- Modify: `packages/bundle/web-app/cordis.patch.yml` (add the ui-settings-mcp entry in the client section)
- Modify: `packages/bundle/web-app/package.json` (add `@deepseek-ai/dsh-client-ui-settings-mcp` to dependencies)
- Test: `packages/client/ui-settings-mcp/tests/mcp-tab.client.spec.tsx`

**Interfaces:**
- Consumes: `ctx.settingsScope.bind({ namespace })` (`@deepseek-ai/dsh-client-ui-settings/client`) → `SettingsScopeController<McpServersSection>` (`set(serverName, value)` / `unset(serverName)` / `getSnapshot()`); `ctx.remote.mcpServers.list()` (Task 4); the `settings.plugins.tab` slot (declared by `ui-settings-plugins`).
- Produces: the `McpSettingsTab` component + `McpSettingsTabInjected = { list(): Promise<McpServerSnapshot>; setEnabled(serverName: string, enabled: boolean): Promise<void> }`; the locale namespace `settings.mcp`.

- [ ] **Step 1: Package scaffold** (strictly per the `packages/client/AGENTS.md` new-package checklist)

`package.json` template follows `packages/client/ui-settings-plugin-inventory/package.json`: name `@deepseek-ai/dsh-client-ui-settings-mcp`, exports `.`/`./invariant`/`./client`/`./src/*`/`./package.json`, the `dsh.client` manifest (inject lists `@deepseek-ai/dsh-api-remotes`, `@deepseek-ai/dsh-client-runtime`, `@deepseek-ai/dsh-client-ui-settings`, `@deepseek-ai/dsh-client-locale`, platform `web`), peer/dev dependencies same as the template plus `@deepseek-ai/dsh-client-test-runtime`, `@testing-library/react`.

`tsconfig.json` extends `../../../tsconfig.base.client.json`, and references are listed one per dependency (template: ui-settings-plugin-inventory/tsconfig.json).

`tsdown.config.ts` (following `packages/client/ui-settings-plugin-inventory/tsdown.config.ts`):

```ts ignore-check
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-settings-mcp', ['lib/types/index.js', 'lib/types/invariant.js'])
```

`src/index.ts`: empty node-half (`export function apply(): void {}`, following the template package). `src/invariant.ts`: the client-side invariant companion (following the template package structure). `src/css-modules.d.ts`: `declare module '*.module.css'` (following the template package).

All three registration surfaces are in place: the `tsconfig.client.json` references, the web-app cordis.patch.yml entry, and the web-app package.json dependency.

- [ ] **Step 2: Write a failing component test** `tests/mcp-tab.client.spec.tsx`

First line is `// @vitest-environment jsdom`. Feed the component props directly (checklist "component tests feed props directly"):

```tsx
// 场景：
// 1. 渲染 settings 行与 declarative 行；declarative 行显示「由配置文件管理」徽标，
//    开关 aria-disabled
// 2. 搜索框输入过滤 serverName（不区分大小写），无结果显示空搜索文案
// 3. 拨动 settings 行开关 → injected setEnabled 以 (serverName, false) 被调
// 4. 列表为空时显示空态引导与「+」入口
// 5. 连接失败行显示失败标记与错误摘要
```

- [ ] **Step 3: Run to confirm failure**

Run: `pnpm vitest run packages/client/ui-settings-mcp` Expected: FAIL

- [ ] **Step 4: Implement locales / controller / component / styles**

`src/client/locales.ts` (zh is the key source of truth, en mirrors it; follow the `ui-settings-plugin-inventory/src/client/locales.ts` structure):

```ts ignore-check
/** Copy dictionaries for the MCP Settings tab. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  tab: 'MCP',
  search: '搜索 MCP 服务器',
  servers: '服务器',
  empty: '还没有 MCP 服务器，点右上角 + 添加。',
  emptySearch: '没有匹配的服务器。',
  loading: '加载中…',
  error: '加载失败。',
  retry: '重试',
  addServer: '添加 MCP 服务器',
  declarativeTag: '由配置文件管理',
  enabledTag: '已启用',
  disabledTag: '已停用',
  connecting: '连接中',
  ready: '已连接',
  failed: '连接失败',
  edit: '编辑',
  settings: '设置',
} as const

/** English mirror. */
export const en: Record<keyof typeof zh, string> = {
  tab: 'MCP',
  search: 'Search MCP servers',
  servers: 'Servers',
  empty: 'No MCP servers yet — use + to add one.',
  emptySearch: 'No matching servers.',
  loading: 'Loading…',
  error: 'Failed to load.',
  retry: 'Retry',
  addServer: 'Add MCP server',
  declarativeTag: 'Managed by config file',
  enabledTag: 'Enabled',
  disabledTag: 'Disabled',
  connecting: 'Connecting',
  ready: 'Connected',
  failed: 'Connection failed',
  edit: 'Edit',
  settings: 'Settings',
}

/** Locale keys owned by this plugin. */
export type McpLocaleKey = keyof typeof zh
```

`src/client/mcp-tab-controller.ts`: wraps `ctx.settingsScope.bind({ namespace: 'mcp-servers' })` and `ctx.remote.mcpServers.list()`; `setEnabled(serverName, enabled)` reads that server's current value from the scope snapshot and writes it back with `scope.set(serverName, { ...current, enabled })` (a single path-op, preserving the remaining fields and unseen secrets).

`src/client/index.ts` (following the ui-settings-plugin-inventory/src/client/index.ts structure):

```ts ignore-check
/** MCP server roster tab in Web Plugins settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { McpSettingsTab, type McpSettingsTabInjected } from './McpSettingsTab.tsx'
import { McpTabController } from './mcp-tab-controller.ts'
import { en, zh, type McpLocaleKey } from './locales.ts'

export type { McpSettingsTabInjected, McpSettingsTabProps } from './McpSettingsTab.tsx'
export type { McpLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP server roster copy. */
    'settings.mcp': McpLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.mcp'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.mcpServers', 'settingsScope']

/** Contribute the MCP tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-mcp: dictionaries')
  const t = ctx.locale.bind(NS)
  const controller = new McpTabController(ctx.settingsScope.bind({ namespace: 'mcp-servers' }), ctx.remote)
  const injected = (): McpSettingsTabInjected => controller.face()

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'mcp',
    order: 5,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, McpSettingsTab))
}
```

`McpSettingsTab.tsx`: structure follows `PluginInventorySettingsTab.tsx` (loading/error/retry three states, search box, `<ul>` rows); differences: the top row's right side is a search box + a rounded-square "+" button (an add icon inside `<Button variant="outline" size="sm" aria-label={t('addServer')}>`, with `border-radius` using the same card token in CSS); the row end is a gear button + toggle (`<button role="switch" aria-checked=...>`, implemented with button+CSS if ui-primitives has no ready Switch, styled to match figure two); the declarative row's toggle and gear are `disabled` + `title={t('declarativeTag')}`. In this Task, "+" first only switches to an empty add-view placeholder (Task 6 fills in the form); the placeholder view includes a title and a back link — no form fields are rendered.

`McpSettingsTab.module.css`: only `--dsw-*` tokens (docs/web-styling.md), no literal color values; layout aligns with PluginInventorySettingsTab.module.css.

- [ ] **Step 5: Run to confirm passing + coverage**

Run: `pnpm vitest run packages/client/ui-settings-mcp --coverage` Expected: PASS, new package source files at 100% coverage

- [ ] **Step 6: bundle and type check**

Run: `pnpm --filter @deepseek-ai/dsh-client-ui-settings-mcp bundle && pnpm run typecheck:contracts-ready` Expected: compiles

- [ ] **Step 7: Commit**

```bash
git add packages/client/ui-settings-mcp tsconfig.client.json packages/bundle/web-app
git commit -m "feat(ui-settings-mcp): MCP roster tab with search, toggles, and read-only declarative rows"
```

---

### Task 6: add-server view (form + validation + save)

**Files:**
- Create: `packages/client/ui-settings-mcp/src/client/AddServerForm.tsx`
- Create: `packages/client/ui-settings-mcp/src/client/AddServerForm.module.css` (if it cannot be combined with the main styles)
- Modify: `packages/client/ui-settings-mcp/src/client/McpSettingsTab.tsx` ("+" switches to the add view)
- Modify: `packages/client/ui-settings-mcp/src/client/mcp-tab-controller.ts` (`addServer`)
- Modify: `packages/client/ui-settings-mcp/src/client/locales.ts` (form copy)
- Test: `packages/client/ui-settings-mcp/tests/add-server.client.spec.tsx`

**Interfaces:**
- Consumes: Task 5's controller and component skeleton.
- Produces: `McpSettingsTabInjected` adds `addServer(entry: NewServerDraft): Promise<string | null>` (returns the error key or null); `NewServerDraft = { serverName: string } & ({ transport: 'stdio'; command: string; args: string[]; env: Record<string, string>; cwd: string } | { transport: 'streamable-http'; url: string; headers: Record<string, string> }) & { toolCallTimeoutMs?: number }`.

- [ ] **Step 1: Write a failing form test**

```tsx
// 场景：
// 1. 默认 stdio：渲染 名称/命令/参数/环境变量/工作目录/超时 字段
// 2. 切到 streamable-http：渲染 名称/URL/请求头/超时
// 3. 非法名称（含空格）→ 行内错误，提交按钮禁用，addServer 未被调
// 4. 与现有 server 重名 → 行内错误
// 5. stdio 缺 command / http 缺 url → 行内错误
// 6. 合法提交 → addServer 收到完整 draft；保存中按钮禁用；成功后回到列表
// 7. args 输入按行/逗号拆分；env/headers 以 KEY=VALUE 行解析
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run packages/client/ui-settings-mcp` Expected: FAIL

- [ ] **Step 3: Implement the form and save**

`AddServerForm.tsx`: a controlled form; the local validation function `validateDraft(draft, existingNames): McpLocaleKey | null` is exported as a pure function for tests to call directly; field components reuse `ui-primitives` input widgets (following the `fields.tsx` usage in ui-settings-plugins).

controller:

```ts ignore-check
/**
 * Persist one new server as a single path-op; the settings validate hook
 * remains the server-side duplicate/pattern guard, so a rejected write
 * surfaces as the returned error key.
 * @param draft - validated form draft.
 * @returns null on success, otherwise the locale key of the failure.
 */
async addServer(draft: NewServerDraft): Promise<McpLocaleKey | null> {
  const { serverName, ...rest } = draft
  await this.scope.set(serverName, rest)
  // SettingsScopeController 写失败自动重读且不抛错；以快照是否出现该
  // serverName 判定成败（与卡片模式一致）。
  return this.scope.getSnapshot().value?.[serverName] ? null : 'saveFailed'
}
```

After saving, the view switches back to the list (component-local state).

- [ ] **Step 4: Run to confirm passing + coverage**

Run: `pnpm vitest run packages/client/ui-settings-mcp --coverage` Expected: PASS, 100% coverage

- [ ] **Step 5: Commit**

```bash
git add packages/client/ui-settings-mcp
git commit -m "feat(ui-settings-mcp): add-server form with inline validation"
```

---

### Task 7: edit / remove + secret redaction handling

**Files:**
- Create: `packages/client/ui-settings-mcp/src/client/EditServerForm.tsx`
- Modify: `packages/client/ui-settings-mcp/src/client/McpSettingsTab.tsx` (gear expands the edit view)
- Modify: `packages/client/ui-settings-mcp/src/client/mcp-tab-controller.ts` (`updateServer` / `removeServer`)
- Modify: `packages/client/ui-settings-mcp/src/client/locales.ts`
- Test: `packages/client/ui-settings-mcp/tests/edit-server.client.spec.tsx`

**Interfaces:**
- Produces: `McpSettingsTabInjected` adds `updateServer(serverName: string, patch: Partial<NewServerDraft>): Promise<string | null>` and `removeServer(serverName: string): Promise<void>`.

- [ ] **Step 1: Write a failing test**

```tsx
// 场景：
// 1. 齿轮展开行内编辑表单，非 secret 字段预填当前值
// 2. env/headers 显示脱敏占位（不渲染实际值），留空保存不改动既有 secret
//    （controller 只对提交的字段发 path-op，不整对象 replace）
// 3. 修改 command 保存 → updateServer 以增量 patch 调用
// 4. 删除按钮 + 确认 → removeServer 调用；行从列表消失
// 5. declarative 行无齿轮/开关可用（disabled）
```

- [ ] **Step 2: Run to confirm failure → Step 3: Implement → Step 4: Confirm passing**

controller:

```ts ignore-check
/** Apply a partial patch to one server entry, untouched fields (including
 *  redacted secrets) keep their stored values via per-field path-ops. */
async updateServer(serverName: string, patch: Partial<NewServerDraft>): Promise<McpLocaleKey | null> {
  const current = this.scope.getSnapshot().value?.[serverName]
  if (!current) return 'loadFailed'
  await this.scope.set(serverName, { ...current, ...patch })
  return null
}

/** Remove one server entry. */
async removeServer(serverName: string): Promise<void> {
  await this.scope.unset(serverName)
}
```

Note that `SettingsScopeController.set` is a whole-field `path: [serverName]` overwrite: the patch merge must be based on the snapshot's current value, and secret fields (env/headers) are absent from the redacted snapshot — so when the patch lacks env/headers, the merged value would clear them. Workaround: the controller reads `snapshot.secrets` (the descriptor's secret bit table) to decide whether the server has stored secrets; if so, the edit form's env/headers left empty means "keep unchanged", and on submit, if the user left them unfilled, the env/headers keys are not put into the merged value — but `set(serverName, value)` is a whole-value overwrite, so a missing key is cleared. Therefore `updateServer` must switch to fine-grained path-ops: `SettingsScopeController` only has set/unset(field). The implementer checks whether `SettingsScope` exposes arbitrary path writes; if not, add `setPath(path: string[], value: unknown)` to ui-settings' SettingsScopeController (a small change, committed with this Task along with its unit test), sending ops field by field and leaving secret keys untouched. Removing a whole server still uses `unset(serverName)`.

- [ ] **Step 5: Commit**

```bash
git add packages/client/ui-settings-mcp packages/client/ui-settings
git commit -m "feat(ui-settings-mcp): edit and remove servers with secret-preserving writes"
```

---

### Task 8: e2e tests and affected golden updates

**Files:**
- Create: `apps/web/tests/mcp-config.e2e.ts`
- Create: `apps/web/tests/snapshots/mcp-config/` (aria golden)
- Modify: `apps/web/tests/snapshots/plugin-config/section.expected.md` (the Plugins page gains the MCP tab, aria snapshot changes)
- Modify: `tsconfig.host.json` (add `apps/web/tests/mcp-config.e2e.ts` to include)

**Interfaces:**
- Consumes: the complete UI from Tasks 5-7; `launchWebScaffold`, `captureStableAria`, `compareOrRefreshGolden`, `assertFixtureInventory` (`apps/web/tests/scaffold.ts`).

- [ ] **Step 1: Write the e2e** (structure follows `plugin-config.e2e.ts`: shared page, Chinese locale, `openPlugins()` then click the MCP tab)

```ts ignore-check
// 场景（每个 it 一个）：
// 1. MCP tab 渲染：搜索框、「+」按钮、aria golden 对比
// 2. 添加一台 stdio server（command 用 fixture 假命令）→ settings.yaml 出现
//    mcp-servers 段（expect.poll 读 scaffold.harnessHome/settings.yaml）
// 3. 开关拨到停 → settings.yaml 中 enabled: false；拨回 → true
// 4. 搜索框过滤行
// 5. 删除 → settings.yaml 该 key 消失
// 6. declarative 行只读：scaffold 组合加载 memorix 示例 patch 时（若 scaffold
//    支持 overlay 参数；不支持则此场景挪到单测层覆盖，e2e 只断言无 declarative
//    行时空列表正常）——实现者先查 launchWebScaffold 的 patch 参数
// 7. assertFixtureInventory 锁定 snapshots/mcp-config 清单
```

- [ ] **Step 2: Run and record the golden**

Run: `pnpm vitest run apps/web/tests/mcp-config.e2e.ts` (replay/refresh mode follows `webSnapshotMode()`; after the first run generates the golden, review that its content is reasonable)

Also update `plugin-config`'s `section.expected.md`: Run `DSH_SNAPSHOT=refresh pnpm vitest run apps/web/tests/plugin-config.e2e.ts`, and confirm via diff that the only change is the added MCP tab.

Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web tsconfig.host.json
git commit -m "test(web): MCP settings tab e2e with settings.yaml write-through"
```

---

### Task 9: documentation, Agent Note, wrap-up checks

**Files:**
- Modify: `docs/config-catalog.md` (if it is generated, change the source and re-run `pnpm run gen-config-catalog`; check the file header marker first)
- Create: `.agents/notes/implemented/feature/2026-08-13-mcp-settings-page.md` (per the `.agents/notes/README.md` format)
- Modify: `packages/mcp/mcp-client/README.md` / `README.zh.md` (a "relationship to mcp-manager" section: declarative wiring is unchanged, panel management goes through mcp-manager)
- Create/Update: finalize the new package READMEs (Tasks 1/5 created the skeletons, this Task fills in the required sections such as Model Experience)

- [ ] **Step 1: Write the Agent Note** (content: the four decisions, data model, supervision model, the two-layer validate write-time rejection + mcp-client load fallback, secret handling, test surface)

- [ ] **Step 2: Update config-catalog and the mcp-client README**

- [ ] **Step 3: Run the checks for this change surface per dsh-pre-push-checks**

Run (in the worktree):
```sh
pnpm run test:gui                                   # client 套件
pnpm vitest run packages/mcp/mcp-manager            # host 新包
pnpm vitest run apps/web/tests/mcp-config.e2e.ts apps/web/tests/plugin-config.e2e.ts
pnpm run typecheck
pnpm run lint
DSH_SNAPSHOT=replay pnpm run test:web               # 装配输出变化面
pnpm run doc-sync                                   # 文档门禁
```
Expected: all green; if some gate conflicts with the new package structure (knip/publint/workspace constraints), fix the package manifest per the error.

- [ ] **Step 4: Commit**

```bash
git add docs .agents/notes packages/mcp
git commit -m "docs: MCP settings page catalogs, READMEs, and agent note"
```

---

## Wrap-up (merge back to master)

After all tasks are green: `git checkout master && git merge feat/mcp-settings-page` (or open a PR to the fork per the user's instructions). The design-document commits (`004165f0b2`, `b5bf57d9b0` on master) wait for the main workspace's WIP typecheck fix before `git push origin master`; the feature branch push is likewise done only after the gates pass.
