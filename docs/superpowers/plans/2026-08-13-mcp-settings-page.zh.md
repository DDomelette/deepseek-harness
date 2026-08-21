# MCP 设置页实现计划

[English](2026-08-13-mcp-settings-page.md) | 中文

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Web 设置对话框「插件」页新增 MCP tab：展示 settings 管理与 cordis.yml 声明式的 MCP server 列表、热生效开关、搜索框、「+」添加/编辑/删除，风格与现有设置页一致。

**Architecture:** 新 host 包 `@deepseek-ai/dsh-mcp-manager` 注册 settings 命名空间 `mcp-servers`（`applies: 'live'`），watch 后 diff 并动态 `ctx.plugin(McpClient)` 挂载/卸载；同包提供 Typert remote `mcpServers.list()` 投影 settings + declarative 两来源。新 client 包 `@deepseek-ai/dsh-client-ui-settings-mcp` 注册 `settings.plugins.tab`（id `mcp`，order 5），经 `ctx.settingsScope.bind({ namespace: 'mcp-servers' })` 读写。api-proxy 白名单加入 `mcp-servers`。

**Tech Stack:** TypeScript ESM（strict）、vendored Cordis、schemastery、React 18 + CSS Modules + clsx、`@deepseek-ai/dsh-client-ui-primitives`、vitest、Playwright e2e。

**设计文档：** `docs/superpowers/specs/2026-08-13-mcp-settings-page-design.md`（已批准；工作树分支 `feat/mcp-settings-page`，工作目录 `.worktrees/mcp-settings-page`）。

## Global Constraints

- 所有命令在工作树根 `D:/Deepseek_Harness/.worktrees/mcp-settings-page` 下执行。
- 包名：host 侧 `@deepseek-ai/dsh-mcp-manager`，client 侧 `@deepseek-ai/dsh-client-ui-<name>`；`@deepseek-ai/cordis` 是每个包的 peerDependency + devDependency。
- ESM：`"type": "module"`；跨包用包名导入，本地相对导入带 `.ts` 扩展名。
- serverName 约束 `/^[A-Za-z0-9_-]{1,32}$/`（与 mcp-client 一致）；settings 命名空间字面量 `mcp-servers`，经 `settingsNamespace()` 品牌化。
- secret 字段（`env`/`headers`）必须 `role('secret')`；wire 面只读脱敏视图，写走 path-op。
- 不改动 `packages/mcp/mcp-client` 的任何文件；不改写 cordis.yml。
- 每个贡献走 `ctx.effect()` / `ctx.on()`；misconfiguration fails loud；双语 README + `README.i18n.yaml` 配对（doc-sync 门禁）。
- 产品文案中文，代码注释英文；JSDoc 遵守 `verify-export-jsdoc`（每个导出符号 `@param`/`@returns`）。
- 测试政策：client 源码在 per-file 100% 覆盖率门禁内（`pnpm run test:coverage`）；jsdom 环境用 spec 首行 `// @vitest-environment jsdom` pragma。
- 提交信息格式遵循仓库既有历史（如 `feat: ...`）；每个 Task 结束提交一次。

---

### Task 1: host 包脚手架 + `mcp-servers` schema + settings 注册（含写时重名拒绝）

**Files:**
- Create: `packages/mcp/mcp-manager/package.json`
- Create: `packages/mcp/mcp-manager/tsconfig.json`
- Create: `packages/mcp/mcp-manager/src/schema.ts`
- Create: `packages/mcp/mcp-manager/src/declarative.ts`
- Create: `packages/mcp/mcp-manager/src/index.ts`
- Create: `packages/mcp/mcp-manager/src/invariant.ts`
- Create: `packages/mcp/mcp-manager/README.md`、`README.zh.md`、`README.i18n.yaml`
- Modify: `tsconfig.host.json`（references 列表，按字母序插入）
- Test: `packages/mcp/mcp-manager/tests/schema.spec.ts`、`packages/mcp/mcp-manager/tests/register.spec.ts`

**Interfaces:**
- Consumes: `settingsNamespace` / `SettingsRegisterOptions`（`@deepseek-ai/dsh-settings`）；`ctx.loader.entries()`（`@deepseek-ai/cordis-plugin-loader` 的 Context merge）。
- Produces（后续 Task 依赖）：
  - `MCP_SERVERS_NS: 'mcp-servers'`（`schema.ts`）
  - `SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/`（`schema.ts`）
  - `McpServersSchema: z<McpServersSection>`、`McpServerEntryConfig`（`enabled/transport/command?/args?/env?/cwd?/url?/headers?/toolCallTimeoutMs/failOnStartupError` 的全解析类型，所有 optional 字段在解析后必有值）、`McpServersSection = Record<string, McpServerEntryConfig>`（`schema.ts`）
  - `declarativeMcpServers(ctx: Context): DeclarativeMcpServer[]`，其中 `DeclarativeMcpServer = { serverName: string; transport: 'stdio' | 'streamable-http'; enabled: boolean; fiberPhase: PluginFiberPhaseLike }`（`declarative.ts`；Task 3 的 gateway 复用）
  - 插件导出 `name = 'mcp-manager'`、`inject`、`apply`（`index.ts`）

- [ ] **Step 1: 写失败的 schema 测试** `packages/mcp/mcp-manager/tests/schema.spec.ts`

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

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run packages/mcp/mcp-manager/tests/schema.spec.ts` Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 schema** `packages/mcp/mcp-manager/src/schema.ts`

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

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run packages/mcp/mcp-manager/tests/schema.spec.ts` Expected: PASS

- [ ] **Step 5: 写失败的注册/重名拒绝测试** `packages/mcp/mcp-manager/tests/register.spec.ts`

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

其中 `settingsNamespaceLike` 即 `settingsNamespace`（从 `@deepseek-ai/dsh-settings` 导入）；`ctx.settings.update` 签名为 `update(ns, patch)`——实现者以 `packages/settings/settings/src/index.ts` 的 `SettingsProvider` 公开签名为准调整调用形状。

- [ ] **Step 6: 运行确认失败**

Run: `pnpm vitest run packages/mcp/mcp-manager/tests/register.spec.ts` Expected: FAIL

- [ ] **Step 7: 实现 declarative 投影与插件注册**

`packages/mcp/mcp-manager/src/declarative.ts`：

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

`packages/mcp/mcp-manager/src/index.ts`：

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

- [ ] **Step 8: 包脚手架**

`packages/mcp/mcp-manager/package.json`（模板：`packages/host/plugin-inventory/package.json`；`./typert`、`./remote` 导出在 Task 3 才加，本 Task 不含）：

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

`packages/mcp/mcp-manager/tsconfig.json`（模板：`packages/host/plugin-inventory/tsconfig.json`，references 按实际依赖：`vendor/cordis`、`vendor/loader`、`../../settings/settings`、`../../runtime-diagnostics/invariants`、`../mcp-client`）。

`packages/mcp/mcp-manager/src/invariant.ts`：照抄 `packages/host/plugin-inventory/src/invariant.ts` 结构，`PACKAGE_NAME` 改为 `'@deepseek-ai/dsh-mcp-manager'`，`name = 'mcp-manager-invariant'`；invariant 安装体断言「settings 管理的 serverName 与 declarative 无交集」（查 `declarativeMcpServers` 与注册值；若注册未发生则按 packages/AGENTS.md 规则写 explained empty companion）。

`tsconfig.host.json`：在 `references` 数组按现有排序加 `{ "path": "./packages/mcp/mcp-manager" }`。

README.md / README.zh.md / README.i18n.yaml：参照 `packages/mcp/mcp-client/README.md` 的双语结构与 i18n.yaml 格式，内容覆盖：能力（settings 命名空间 + 热挂载 + 只读 declarative 投影）、配置表、与 mcp-client 的关系。

- [ ] **Step 9: 安装依赖并运行测试**

Run: `pnpm install && pnpm vitest run packages/mcp/mcp-manager` Expected: PASS

- [ ] **Step 10: 类型检查**

Run: `pnpm run build:lib:host` Expected: 编译通过

- [ ] **Step 11: Commit**

```bash
git add packages/mcp/mcp-manager tsconfig.host.json pnpm-lock.yaml
git commit -m "feat(mcp-manager): scaffold package with mcp-servers settings namespace"
```

---

### Task 2: 动态挂载 supervisor（diff + ctx.plugin 热挂载 + 状态跟踪）

**Files:**
- Create: `packages/mcp/mcp-manager/src/supervisor.ts`
- Modify: `packages/mcp/mcp-manager/src/index.ts`（接入 supervisor）
- Test: `packages/mcp/mcp-manager/tests/supervisor.spec.ts`、`packages/mcp/mcp-manager/tests/mount.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `McpServersSection`、`McpServerEntryConfig`；`@deepseek-ai/dsh-mcp-client` 的命名空间插件对象（`import * as McpClient from '@deepseek-ai/dsh-mcp-client'`，`ctx.plugin(McpClient, config)` 返回可 await 的 `Fiber`，`fiber.dispose(): Promise<void>`）。
- Produces：
  - `planServerDiff(prev: McpServersSection, next: McpServersSection): ServerAction[]`，`ServerAction = { kind: 'mount' | 'dispose' | 'remount'; serverName: string }`（纯函数）
  - `McpServerSupervisor`：`sync(next: McpServersSection): void`、`list(): ManagedServerState[]`、`dispose(): Promise<void>`；`ManagedServerState = { serverName: string; enabled: boolean; status: 'connecting' | 'ready' | 'failed'; error?: string }`

- [ ] **Step 1: 写失败的 diff 纯函数测试** `tests/supervisor.spec.ts`

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

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run packages/mcp/mcp-manager/tests/supervisor.spec.ts` Expected: FAIL

- [ ] **Step 3: 实现 supervisor** `src/supervisor.ts`

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

注意：disabled 的 settings 条目也要出现在 `list()`（面板要显示它但 status 标 disabled）——实现时把 `list()` 改为遍历 `this.section`：enabled 的读 mounts 状态，disabled 的返回 `{ serverName, enabled: false, status: 'failed' }`……不，`status` 语义改为 `'connecting' | 'ready' | 'failed'`，disabled 条目不上报 status——见 Task 3 的 list entry 类型（`status: McpServerStatus | null`，disabled 为 `null`）。实现者按 Task 3 类型对齐。

- [ ] **Step 4: 运行 diff 测试确认通过**

Run: `pnpm vitest run packages/mcp/mcp-manager/tests/supervisor.spec.ts` Expected: PASS

- [ ] **Step 5: 写挂载集成测试** `tests/mount.spec.ts`

用 `packages/mcp/mcp-client/tests/fixture-server.ts` 的既有 stdio fixture（`command: process.execPath`，参照 `mcp-client.e2e.ts:73` 的起服方式）：

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

每个 it 内联完整断言代码（不允许留空实现）；工具存在性断言参照 `packages/mcp/mcp-client/tests/apply.spec.ts` 对 `ctx.tools` 的读法。

- [ ] **Step 6: 运行确认失败（supervisor 尚未接入 index.ts）**

Run: `pnpm vitest run packages/mcp/mcp-manager/tests/mount.spec.ts` Expected: FAIL

- [ ] **Step 7: 接入 index.ts**

`apply` 的 `ctx.inject` 回调内、注册之后：

```ts ignore-check
const scope = sctx.settings.register(/* …Task 1 内容… */)
const supervisor = new McpServerSupervisor(sctx)
supervisor.sync(scope.get())
sctx.effect(() => scope.watch((next) => { supervisor.sync(next) }), 'mcp-manager: settings watch')
sctx.effect(() => () => supervisor.dispose(), 'mcp-manager: roster teardown')
```

- [ ] **Step 8: 运行全部 mcp-manager 测试确认通过**

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
- Create: `packages/mcp/mcp-manager/src/index.ts`
- Modify: `packages/mcp/mcp-manager/src/index.ts`（default export gateway；参照 plugin-inventory `export default PluginInventoryGateway`）
- Modify: `packages/mcp/mcp-manager/package.json`（加 `./typert`、`./remote` 导出与 `files` 条目、peer/dev 依赖 `@deepseek-ai/dsh-typert-protocol`、`@deepseek-ai/dsh-brand`）
- Modify: `packages/mcp/mcp-manager/tsconfig.json`（references 加 `../../typert/protocol`、`../../util/brand`）
- Modify: `packages/bundle/web-app/cordis.patch.yml`（host 区加 mcp-manager 条目）
- Modify: `packages/bundle/web-app/package.json`（dependencies 加 `@deepseek-ai/dsh-mcp-manager`）
- Test: `packages/mcp/mcp-manager/tests/gateway.spec.ts`

**Interfaces:**
- Consumes: Task 1 `declarativeMcpServers`；Task 2 `McpServerSupervisor.list()`；`TypertRemoteService`/`Remote`（`@deepseek-ai/dsh-typert-protocol`）。
- Produces（client Task 5 依赖）：
  - `McpServerStatus = 'connecting' | 'ready' | 'failed'`（`types.ts`）
  - `McpServerListEntry = { serverName: string; transport: 'stdio' | 'streamable-http'; source: 'settings' | 'declarative'; enabled: boolean; status: McpServerStatus | null; error?: string }`
  - `McpServerSnapshot = { entries: readonly McpServerListEntry[] }`
  - `McpServersGateway extends TypertRemoteService`，`@Remote('list') list(): McpServerSnapshot`；service 名 `'mcpServers'`

- [ ] **Step 1: 写失败的 gateway 测试** `tests/gateway.spec.ts`

```ts ignore-check
// 装配：host app + 假 loader（一条 declarative mcp-client 条目）+ settings 注册
// + supervisor 挂一台 settings server。断言 list() 返回并集：
// - settings 行：source 'settings'、enabled、status 来自 supervisor
// - declarative 行：source 'declarative'、status 为 null、fiberPhase 投影为
//   enabled 字段（!entry.disabled）
// - 条目不含 env/headers 字段（敏感字段不投影）
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run packages/mcp/mcp-manager/tests/gateway.spec.ts` Expected: FAIL

- [ ] **Step 3: 实现 types 与 gateway**

`src/types.ts`：

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

`src/gateway.ts`：

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

实现者注意：`supervisorFor`/`transportOf` 的具体形态由 supervisor 对 section 的持有方式决定——把 `McpServersSection` 存在 supervisor 上（`sync` 已赋值 `this.section`），`list()` 直接产出含 transport 的行比二次查询更简。允许在实现中把 `ManagedServerState` 扩展出 `transport` 字段并同步修订 Task 2 代码与测试。

另注意：agent-preset 内联挂载的 mcp-client 条目不在 `ctx.loader.entries()` 中（`packages/preset/agent-presets/README.md:117`），本投影天然不含它们——这是设计决策（规格的「明确排除」），不是遗漏；gateway 的 JSDoc 写明这一点。

- [ ] **Step 4: 接入 index.ts 并生成 typert artifacts**

index.ts：`export type * from './types.ts'`、`export { McpServersGateway }`、`export default McpServersGateway`；`apply` 内把 supervisor 存入模块级 `WeakMap<Context, McpServerSupervisor>`（key 用 `ctx.root`）供 gateway 读取。

package.json 增加导出对（照 plugin-inventory）：

```json
"./typert": { "types": "./lib/typert.host.d.ts", "default": "./lib/typert.host.js" },
"./remote": { "types": "./lib/typert.remote-client.d.ts", "default": "./lib/typert.remote-client.js" }
```

`files` 增加 `"lib/typert.host.js"`, `"lib/typert.host.d.ts"`, `"lib/typert.remote-client.js"`, `"lib/typert.remote-client.d.ts"`。

Run: `pnpm install && pnpm run build:lib:host`（tsdown 的 typertPlugin 自动扫描 `TypertRemoteService` 子类并生成 artifacts） Expected: `packages/mcp/mcp-manager/lib/typert.host.js` 与 `lib/typert.remote-client.js` 生成

- [ ] **Step 5: web-app 组装**

`packages/bundle/web-app/cordis.patch.yml`：在 plugin-inventory 条目后加：

```yaml
    # Settings-driven MCP server manager and its read-only roster Remote.
    - id: mcp-manager
      name: '@deepseek-ai/dsh-mcp-manager'
```

`packages/bundle/web-app/package.json`：dependencies 加 `"@deepseek-ai/dsh-mcp-manager": "workspace:^"`。

- [ ] **Step 6: 运行测试**

Run: `pnpm vitest run packages/mcp/mcp-manager` Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/mcp/mcp-manager packages/bundle/web-app
git commit -m "feat(mcp-manager): mcpServers.list remote over settings and declarative rosters"
```

---

### Task 4: api-proxy 白名单 + api-remotes 聚合

**Files:**
- Modify: `packages/host/apiproxy/src/api-proxy.ts:127-130`（`WEB_SETTINGS_NAMESPACES`）
- Modify: `packages/api/remotes/src/client/index.ts`（mount + 类型再导出）
- Modify: `packages/api/remotes/package.json`（dependencies 加 `@deepseek-ai/dsh-mcp-manager`）
- Test: `packages/host/apiproxy/tests/api-proxy-config.spec.ts`（追加用例）

**Interfaces:**
- Consumes: Task 3 的 `./remote` 与 `./types` 导出。
- Produces: client 侧 `ctx.remote.mcpServers.list()` 可用；`settings.describe/mutate` 接受 `mcp-servers`。

- [ ] **Step 1: 写失败的白名单测试**

在 `api-proxy-config.spec.ts` 追加（参照 L324 起的 "serves model-provider and explicitly allowlisted Web namespaces only" 用例）：

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

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run packages/host/apiproxy/tests/api-proxy-config.spec.ts -t mcp-servers` Expected: FAIL（`settings-not-exposed` 或 namespaces 不含）

- [ ] **Step 3: 加白名单与聚合**

`api-proxy.ts` `WEB_SETTINGS_NAMESPACES` 数组加 `'mcp-servers'`，并更新其 JSDoc（L117-126，点明 MCP 面板是该页的一个 section）。

`packages/api/remotes/src/client/index.ts`：照 pluginInventory 的三处模式——

```ts ignore-check
import mcpServersRemote from '@deepseek-ai/dsh-mcp-manager/remote'
export type { McpServerListEntry, McpServerSnapshot, McpServerStatus } from '@deepseek-ai/dsh-mcp-manager/types'
export type {} from '@deepseek-ai/dsh-mcp-manager/remote'
// mount 列表：commandsRemote, goalsRemote, dynamicRemote, pluginInventoryRemote, messageFeedbackRemote, mcpServersRemote
```

`packages/api/remotes/package.json` dependencies 加 `"@deepseek-ai/dsh-mcp-manager": "workspace:^"`。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm install && pnpm vitest run packages/host/apiproxy/tests/api-proxy-config.spec.ts` Expected: PASS

- [ ] **Step 5: 类型检查**

Run: `pnpm run build:lib:host && pnpm run typecheck:contracts-ready` Expected: 编译通过

- [ ] **Step 6: Commit**

```bash
git add packages/host/apiproxy packages/api/remotes
git commit -m "feat(apiproxy): expose the mcp-servers namespace and mcpServers remote to the Web client"
```

---

### Task 5: client 包脚手架 + MCP tab 列表视图（搜索 + 开关 + 声明式只读行）

**Files:**
- Create: `packages/client/ui-settings-mcp/package.json`
- Create: `packages/client/ui-settings-mcp/tsconfig.json`
- Create: `packages/client/ui-settings-mcp/tsdown.config.ts`
- Create: `packages/client/ui-settings-mcp/src/index.ts`（空 node-half apply）
- Create: `packages/client/ui-settings-mcp/src/invariant.ts`
- Create: `packages/client/ui-settings-mcp/src/css-modules.d.ts`
- Create: `packages/client/ui-settings-mcp/src/client/index.ts`
- Create: `packages/client/ui-settings-mcp/src/client/locales.ts`
- Create: `packages/client/ui-settings-mcp/src/client/mcp-tab-controller.ts`
- Create: `packages/client/ui-settings-mcp/src/client/McpSettingsTab.tsx`
- Create: `packages/client/ui-settings-mcp/src/client/McpSettingsTab.module.css`
- Create: `packages/client/ui-settings-mcp/README.md`
- Modify: `tsconfig.client.json`（references 加 `./packages/client/ui-settings-mcp`）
- Modify: `packages/bundle/web-app/cordis.patch.yml`（client 区加 ui-settings-mcp 条目）
- Modify: `packages/bundle/web-app/package.json`（dependencies 加 `@deepseek-ai/dsh-client-ui-settings-mcp`）
- Test: `packages/client/ui-settings-mcp/tests/mcp-tab.client.spec.tsx`

**Interfaces:**
- Consumes: `ctx.settingsScope.bind({ namespace })`（`@deepseek-ai/dsh-client-ui-settings/client`）→ `SettingsScopeController<McpServersSection>`（`set(serverName, value)` / `unset(serverName)` / `getSnapshot()`）；`ctx.remote.mcpServers.list()`（Task 4）；slot `settings.plugins.tab`（`ui-settings-plugins` 声明）。
- Produces：`McpSettingsTab` 组件 + `McpSettingsTabInjected = { list(): Promise<McpServerSnapshot>; setEnabled(serverName: string, enabled: boolean): Promise<void> }`；locale namespace `settings.mcp`。

- [ ] **Step 1: 包脚手架**（严格按 `packages/client/AGENTS.md` 新包 checklist）

`package.json` 模板照 `packages/client/ui-settings-plugin-inventory/package.json`：name `@deepseek-ai/dsh-client-ui-settings-mcp`，exports `.`/`./invariant`/`./client`/`./src/*`/`./package.json`，`dsh.client` manifest（inject 列 `@deepseek-ai/dsh-api-remotes`、`@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-ui-settings`、`@deepseek-ai/dsh-client-locale`，platform `web`），peer/dev 依赖同模板外加 `@deepseek-ai/dsh-client-test-runtime`、`@testing-library/react`。

`tsconfig.json` extends `../../../tsconfig.base.client.json`，references 按依赖逐个列（模板：ui-settings-plugin-inventory/tsconfig.json）。

`tsdown.config.ts`（照 `packages/client/ui-settings-plugin-inventory/tsdown.config.ts`）：

```ts ignore-check
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-settings-mcp', ['lib/types/index.js', 'lib/types/invariant.js'])
```

`src/index.ts`：空 node-half（`export function apply(): void {}`，照模板包）。`src/invariant.ts`：client 侧 invariant companion（照模板包结构）。`src/css-modules.d.ts`：`declare module '*.module.css'`（照模板包）。

三个注册面全部到位：`tsconfig.client.json` references、web-app cordis.patch.yml 条目、web-app package.json 依赖。

- [ ] **Step 2: 写失败的组件测试** `tests/mcp-tab.client.spec.tsx`

首行 `// @vitest-environment jsdom`。组件直接喂 props（checklist「component tests feed props directly」）：

```tsx
// 场景：
// 1. 渲染 settings 行与 declarative 行；declarative 行显示「由配置文件管理」徽标，
//    开关 aria-disabled
// 2. 搜索框输入过滤 serverName（不区分大小写），无结果显示空搜索文案
// 3. 拨动 settings 行开关 → injected setEnabled 以 (serverName, false) 被调
// 4. 列表为空时显示空态引导与「+」入口
// 5. 连接失败行显示失败标记与错误摘要
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm vitest run packages/client/ui-settings-mcp` Expected: FAIL

- [ ] **Step 4: 实现 locales / controller / 组件 / 样式**

`src/client/locales.ts`（zh 为 key 源头，en 镜像；照 `ui-settings-plugin-inventory/src/client/locales.ts` 结构）：

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

`src/client/mcp-tab-controller.ts`：封装 `ctx.settingsScope.bind({ namespace: 'mcp-servers' })` 与 `ctx.remote.mcpServers.list()`；`setEnabled(serverName, enabled)` 读 scope 快照中该 server 的当前值，以 `scope.set(serverName, { ...current, enabled })` 写回（单 path-op，保留其余字段与未见的 secret）。

`src/client/index.ts`（照 ui-settings-plugin-inventory/src/client/index.ts 结构）：

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

`McpSettingsTab.tsx`：结构照 `PluginInventorySettingsTab.tsx`（loading/error/retry 三态、搜索框、`<ul>` 行）；差异：顶部行右侧是搜索框 + 圆角方形「+」按钮（`<Button variant="outline" size="sm" aria-label={t('addServer')}>` 内 add 图标，CSS 里 `border-radius` 用卡片同款 token）；行尾是齿轮按钮 + toggle（`<button role="switch" aria-checked=...>`，ui-primitives 若无现成 Switch 则用 button+CSS 实现，样式对齐图二）；declarative 行 toggle 与齿轮 `disabled` + `title={t('declarativeTag')}`。「+」本 Task 先只切换到空添加视图占位（Task 6 填表单），占位视图含标题与返回链接——不渲染表单字段。

`McpSettingsTab.module.css`：只用 `--dsw-*` token（docs/web-styling.md），无字面色值；版式对齐 PluginInventorySettingsTab.module.css。

- [ ] **Step 5: 运行确认通过 + 覆盖率**

Run: `pnpm vitest run packages/client/ui-settings-mcp --coverage` Expected: PASS，新包源文件 100% 覆盖

- [ ] **Step 6: bundle 与类型检查**

Run: `pnpm --filter @deepseek-ai/dsh-client-ui-settings-mcp bundle && pnpm run typecheck:contracts-ready` Expected: 编译通过

- [ ] **Step 7: Commit**

```bash
git add packages/client/ui-settings-mcp tsconfig.client.json packages/bundle/web-app
git commit -m "feat(ui-settings-mcp): MCP roster tab with search, toggles, and read-only declarative rows"
```

---

### Task 6: 添加服务器视图（表单 + 校验 + 保存）

**Files:**
- Create: `packages/client/ui-settings-mcp/src/client/AddServerForm.tsx`
- Create: `packages/client/ui-settings-mcp/src/client/AddServerForm.module.css`（若与主样式无法合置）
- Modify: `packages/client/ui-settings-mcp/src/client/McpSettingsTab.tsx`（「+」切换到添加视图）
- Modify: `packages/client/ui-settings-mcp/src/client/mcp-tab-controller.ts`（`addServer`）
- Modify: `packages/client/ui-settings-mcp/src/client/locales.ts`（表单文案）
- Test: `packages/client/ui-settings-mcp/tests/add-server.client.spec.tsx`

**Interfaces:**
- Consumes: Task 5 的 controller 与组件骨架。
- Produces: `McpSettingsTabInjected` 增加 `addServer(entry: NewServerDraft): Promise<string | null>`（返回错误 key 或 null）；`NewServerDraft = { serverName: string } & ({ transport: 'stdio'; command: string; args: string[]; env: Record<string, string>; cwd: string } | { transport: 'streamable-http'; url: string; headers: Record<string, string> }) & { toolCallTimeoutMs?: number }`。

- [ ] **Step 1: 写失败的表单测试**

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

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run packages/client/ui-settings-mcp` Expected: FAIL

- [ ] **Step 3: 实现表单与保存**

`AddServerForm.tsx`：受控表单；本地校验函数 `validateDraft(draft, existingNames): McpLocaleKey | null` 纯函数导出供测试直调；字段组件复用 `ui-primitives` 的输入件（参照 ui-settings-plugins 的 `fields.tsx` 用法）。

controller：

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

保存后视图切回列表（组件本地 state）。

- [ ] **Step 4: 运行确认通过 + 覆盖率**

Run: `pnpm vitest run packages/client/ui-settings-mcp --coverage` Expected: PASS，100% 覆盖

- [ ] **Step 5: Commit**

```bash
git add packages/client/ui-settings-mcp
git commit -m "feat(ui-settings-mcp): add-server form with inline validation"
```

---

### Task 7: 编辑 / 删除 + secret 脱敏处理

**Files:**
- Create: `packages/client/ui-settings-mcp/src/client/EditServerForm.tsx`
- Modify: `packages/client/ui-settings-mcp/src/client/McpSettingsTab.tsx`（齿轮展开编辑视图）
- Modify: `packages/client/ui-settings-mcp/src/client/mcp-tab-controller.ts`（`updateServer` / `removeServer`）
- Modify: `packages/client/ui-settings-mcp/src/client/locales.ts`
- Test: `packages/client/ui-settings-mcp/tests/edit-server.client.spec.tsx`

**Interfaces:**
- Produces: `McpSettingsTabInjected` 增加 `updateServer(serverName: string, patch: Partial<NewServerDraft>): Promise<string | null>` 与 `removeServer(serverName: string): Promise<void>`。

- [ ] **Step 1: 写失败的测试**

```tsx
// 场景：
// 1. 齿轮展开行内编辑表单，非 secret 字段预填当前值
// 2. env/headers 显示脱敏占位（不渲染实际值），留空保存不改动既有 secret
//    （controller 只对提交的字段发 path-op，不整对象 replace）
// 3. 修改 command 保存 → updateServer 以增量 patch 调用
// 4. 删除按钮 + 确认 → removeServer 调用；行从列表消失
// 5. declarative 行无齿轮/开关可用（disabled）
```

- [ ] **Step 2: 运行确认失败 → Step 3: 实现 → Step 4: 通过**

controller：

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

注意 `SettingsScopeController.set` 是整字段 `path: [serverName]` 覆盖：patch 合并必须基于快照当前值，secret 字段（env/headers）在脱敏快照中缺失——因此 patch 里不含 env/headers 时，合并值会把它们清空。规避：controller 读 `snapshot.secrets`（descriptor 的 secret 位表）判断该 server 是否有已存 secret；有则编辑表单的 env/headers 留空表示「保持不变」，提交时若用户未填则不把 env/headers 键放进合并值——但 `set(serverName, value)` 是整值覆盖，缺键即清除。故 `updateServer` 必须改用细粒度 path-op：`SettingsScopeController` 只有 set/unset(field)。实现者检查 `SettingsScope` 是否暴露任意 path 写；若无，则在 ui-settings 的 SettingsScopeController 上加 `setPath(path: string[], value: unknown)`（小改动，随本 Task 提交并补其单测），逐字段发 op，不动 secret 键。删除整台 server 仍用 `unset(serverName)`。

- [ ] **Step 5: Commit**

```bash
git add packages/client/ui-settings-mcp packages/client/ui-settings
git commit -m "feat(ui-settings-mcp): edit and remove servers with secret-preserving writes"
```

---

### Task 8: e2e 测试与受影响 golden 更新

**Files:**
- Create: `apps/web/tests/mcp-config.e2e.ts`
- Create: `apps/web/tests/snapshots/mcp-config/`（aria golden）
- Modify: `apps/web/tests/snapshots/plugin-config/section.expected.md`（插件页新增 MCP tab，aria 快照变化）
- Modify: `tsconfig.host.json`（include 加 `apps/web/tests/mcp-config.e2e.ts`）

**Interfaces:**
- Consumes: Task 5-7 的完整 UI；`launchWebScaffold`、`captureStableAria`、`compareOrRefreshGolden`、`assertFixtureInventory`（`apps/web/tests/scaffold.ts`）。

- [ ] **Step 1: 写 e2e**（结构照 `plugin-config.e2e.ts`：共享 page、中文 locale、`openPlugins()` 后点 MCP tab）

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

- [ ] **Step 2: 运行并录制 golden**

Run: `pnpm vitest run apps/web/tests/mcp-config.e2e.ts`（replay/refresh 模式参照 `webSnapshotMode()`；首次运行生成 golden 后复查其内容合理）

同时更新 `plugin-config` 的 `section.expected.md`：Run `DSH_SNAPSHOT=refresh pnpm vitest run apps/web/tests/plugin-config.e2e.ts`，diff 确认变化仅为新增 MCP tab。

Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web tsconfig.host.json
git commit -m "test(web): MCP settings tab e2e with settings.yaml write-through"
```

---

### Task 9: 文档、Agent Note、收尾检查

**Files:**
- Modify: `docs/config-catalog.md`（若是生成物则改源并重跑 `pnpm run gen-config-catalog`；先查文件头标记）
- Create: `.agents/notes/implemented/feature/2026-08-13-mcp-settings-page.md`（按 `.agents/notes/README.md` 格式）
- Modify: `packages/mcp/mcp-client/README.md` / `README.zh.md`（「与 mcp-manager 的关系」一节：声明式接入不变，面板管理走 mcp-manager）
- Create/Update: 新包 README 定稿（Task 1/5 已建骨架，本 Task 补齐 Model Experience 等必需节）

- [ ] **Step 1: 写 Agent Note**（内容：决策四条、数据模型、 supervise 模型、validate 写时拒绝 + mcp-client 加载兜底双层、secret 处理、测试面）

- [ ] **Step 2: 更新 config-catalog 与 mcp-client README**

- [ ] **Step 3: 按 dsh-pre-push-checks 跑本变更面的检查**

Run（在工作树）:
```sh
pnpm run test:gui                                   # client 套件
pnpm vitest run packages/mcp/mcp-manager            # host 新包
pnpm vitest run apps/web/tests/mcp-config.e2e.ts apps/web/tests/plugin-config.e2e.ts
pnpm run typecheck
pnpm run lint
DSH_SNAPSHOT=replay pnpm run test:web               # 装配输出变化面
pnpm run doc-sync                                   # 文档门禁
```
Expected: 全绿；如某门禁与新包结构冲突（knip/publint/workspace constraints），按报错修正 package 清单。

- [ ] **Step 4: Commit**

```bash
git add docs .agents/notes packages/mcp
git commit -m "docs: MCP settings page catalogs, READMEs, and agent note"
```

---

## 收尾（合并回 master）

全部任务绿后：`git checkout master && git merge feat/mcp-settings-page`（或按用户指示开 PR 到 fork）。设计文档提交（master 上 `004165f0b2`、`b5bf57d9b0`）待主工作区 WIP 修复 typecheck 后 `git push origin master`；feature 分支推送同样等门禁可过后执行。
