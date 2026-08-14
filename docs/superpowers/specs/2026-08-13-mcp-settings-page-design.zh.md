# MCP 配置页设计（Web 设置对话框）

[English](2026-08-13-mcp-settings-page-design.md) | 中文

日期：2026-08-13 状态：已批准（待实现）

## 背景与目标

DeepSeek Harness 已完整支持 MCP（`@deepseek-ai/dsh-mcp-client`，一插件实例 = 一台 server，cordis.yml 声明式接入），但 Web 设置对话框没有 MCP 面板。本设计在「插件」设置页新增 MCP tab，复用现有 settings 通用配置管线：

- 展示现有 MCP server（settings 管理的 + cordis.yml 声明式的）
- 每台 server 的开关状态，切换热生效
- 右上角圆角方形「+」按钮进入添加页（字段按 `dsh-mcp-client` Config schema）
- MCP 服务器搜索框
- 界面风格与现有设置页一致

## 已确认的关键决策

1. **持久化**：settings 命名空间 `mcp-servers`（$DSH_HOME/settings.yaml），复用 settings 管线（schema 校验、revision 冲突控制、secret 脱敏、api-proxy 白名单、document-updated 热更新）。不写 cordis.yml。
2. **生效时机**：热生效——mcp-manager watch settings，开关/增删即时 disconnect/reconnect。
3. **声明式共存**：cordis.yml 声明的 MCP server 列出但只读（来源标记「由配置文件管理」，开关/编辑禁用）。
4. **实现路线**：新增 host 包 `dsh-mcp-manager` + client 包 `ui-settings-mcp`；不改动 mcp-client 的「一实例 = 一 server」模型。

## 架构

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

新包装配走 `packages/client/AGENTS.md` 的新包 checklist：tsconfig 聚合面（host 包进 `tsconfig.host.json` references，client 包进 `tsconfig.client.json`）、`packages/bundle/web-app/cordis.patch.yml` 条目与 `package.json` 依赖、client 包的 `dsh.client` 清单行、host 包的 `invariant` 导出与双语 README 门禁。

## 数据模型（`mcp-servers` 命名空间）

schemastery schema：`z.dict(serverSchema)`，key 为 serverName，沿用 mcp-client 的约束 `/^[A-Za-z0-9_-]{1,32}$/`。

serverSchema 字段（与 mcp-client Config schema 对齐）：

- `enabled: boolean`，默认 `true` —— 面板开关写的就是它
- `transport: 'stdio' | 'streamable-http'`
- stdio：`command: string`、`args?: string[]`、`env?: dict<string>`（`role('secret')`）、`cwd?: string`
- streamable-http：`url: string`、`headers?: dict<string>`（`role('secret')`）
- `toolCallTimeoutMs?: number`，默认 60000
- `failOnStartupError?: boolean`，默认 false

约束：

- env/headers 为 secret 字段：describe 脱敏不回传，写入走 path-op，避免 replace 覆盖未见的 secret。
- 重名防护分两层。写时拒绝：`settings.register` 的 `validate` 选项（`packages/settings/settings/src/index.ts:61`）在写入前比对 settings 字典 key 与 cordis.yml 声明式条目的 serverName，重名即拒绝本次写入——用户在面板添加重名 server 时当场收到拒绝。加载时兜底：mcp-client 按 `ctx.root` 维护活跃 serverName 集合、重复即 load 失败（`packages/mcp/mcp-client/src/index.ts:148-161`），拦截绕过面板的手改 settings.yaml。

## mcp-manager 行为

- 启动：读 resolved config，对每台 `enabled !== false` 的 server 执行 `ctx.plugin(McpClient, { serverName, transport, ... })`。
- `settings/updated`：diff 前后值——新增 → 挂载；删除或 `enabled: false` → dispose；其余字段变更 → dispose 后重挂。所有挂载走 `ctx.effect()` 作用域清理。
- `mcpServers.list()` 返回并集：
  - settings 来源：`{ serverName, source: 'settings', enabled, status: 'connecting' | 'ready' | 'failed', error? }`
  - declarative 来源：manager 直接读 `ctx.loader.entries()`，按 `entry.options.name === '@deepseek-ai/dsh-mcp-client'` 过滤（`entry.options.name` 是 Loader 条目的模块名；`moduleName` 仅是复述 plugin-inventory payload 时的字段名，本设计不复用该 payload），投影 `{ serverName（取自 entry config）, transport, enabled: !entry.disabled, fiberPhase, source: 'declarative' }`；不投影 env/headers 等敏感字段。
- 连接状态跟踪：mcp-client 无对外状态面（`connection.ts` 仅内部 `startConnection`/`ready`/`dispose`），故 manager 在挂载点包装最小状态跟踪（挂载中 → connecting；`ctx.plugin()` 返回的可 await fiber 解决 → ready；拒绝或 fiber 失败 → failed + 错误摘要），不改动 mcp-client 的对外 API。

## 界面（ui-settings-mcp）

tab 顺序：插件配置（order 0）→ **MCP（order 5）** → 插件列表（order 10）。

列表页（结构参考用户提供的图二，风格对齐现有设置页）：

- 顶部行：右侧搜索框（复用 plugin-inventory 的 `type="search"` 输入框模式，按 serverName 过滤）；其旁圆角方形「+」按钮（`Button variant="outline"` + add 图标，圆角与现有卡片一致）。
- server 行：名称、来源徽标（声明式行显示「由配置文件管理」）、右侧齿轮（展开行内编辑表单）、开关 toggle。声明式行开关与齿轮禁用并附提示。
- 空态：无 server 时显示引导文案 + 「+」入口。

添加页（点「+」进入页内视图切换）：

- 字段：名称（serverName 校验）、传输方式分段选择（stdio / streamable-http），按选择渲染对应字段（stdio：command/args/env/cwd；http：url/headers）、toolCallTimeoutMs。
- 前端校验失败（重名、非法 serverName、缺 command/url）行内报错，不发 RPC。
- 保存：经 settings scope 写 `{ op: 'set', path: [serverName], value }` path-op。

编辑 / 删除：

- 齿轮展开行内表单（与添加页同字段）；secret 字段（env/headers）脱敏显示，path-op 写不覆盖未见 secret。
- 删除：`{ op: 'unset', path: [serverName] }`。

技术约定（与现有卡片一致）：React 18 + CSS Modules + clsx；组件/图标用 `@deepseek-ai/dsh-client-ui-primitives`；状态用 `createSnapshotStore` / `SettingsScopeController`；双语 `ctx.locale.register(NS, { zh, en })`。

## 数据流与错误处理

- 读：经 `ctx.settingsScope.bind({ namespace: 'mcp-servers' })`（卡片同款模式，`SettingsScopeController` 内部走 `settings.describe`）+ `ctx.remote.mcpServers.list()` 合并渲染；失效订阅 `settings/document-updated`（由 `SettingsScopeBinder` 既有逻辑处理）与连接状态事件。
- 写：统一经 settings scope 发 path-op（内部即 `settings.mutate` + `expectedRevision`）；`settings-conflict` 由 `SettingsScopeController` 自动重读（既有机制）。
- 单台 server 连接失败只在该行显示失败状态，不阻断其余 server。
- api-proxy 白名单外的读写返回 `settings-not-exposed`（本设计将 `mcp-servers` 加入 `WEB_SETTINGS_NAMESPACES`）。

## 测试计划

- mcp-manager 单测（`packages/mcp/mcp-manager/tests/`）：schema 校验、diff 挂载/卸载、enabled 切换、写时重名拒绝（validate）与加载时兜底。
- ui-settings-mcp client 单测（参照 `ui-settings-plugin-inventory/tests/browser-plugin.client.spec.tsx`）：列表渲染、搜索过滤、添加表单校验。
- e2e `apps/web/tests/mcp-config.e2e.ts`（参照 `plugin-config.e2e.ts`）：列表渲染、搜索过滤、开关写穿 `$DSH_HOME/settings.yaml`、添加流程、声明式只读行；更新受影响的 aria golden。
- 按仓库测试政策补 keyless snapshot（经真实可运行示例的 transcript）。
- 非平凡变更附 Agent Note（`.agents/notes/`）；更新 `docs/config-catalog.md`（新增 `mcp-servers` 命名空间条目）与新包 README。

## 明确排除

- 不改写 cordis.yml（声明式条目保持只读展示）。
- 不改动 `dsh-mcp-client` 的对外 API 与「一实例 = 一 server」模型。
- 不做 MCP server 目录/市场（搜索框只过滤已配置的 server）。
- agent-preset 内联挂载的 mcp-client 条目不在 `ctx.loader.entries()` 中（`packages/preset/agent-presets/README.md:117`），这类 server 不会出现在声明式行，也不在面板管理范围内。
