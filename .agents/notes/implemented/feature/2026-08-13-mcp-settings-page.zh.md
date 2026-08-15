# Agent Note: MCP 设置页 — 面板管理的 MCP 服务器与声明式服务器并存

Status: implemented

[English](2026-08-13-mcp-settings-page.md) | 中文

## Problem

MCP 服务器此前只能以声明式方式配置：在 `cordis.yml` 中每台服务器一行 `@deepseek-ai/dsh-mcp-client`，见 [mcp-client Agent Note](2026-07-07-mcp-client-plugin.md)。Web 用户若不编辑配置文件并热重载，就无法新增、停用、编辑或删除服务器。设置对话框的「插件」分区没有 MCP 页面。

## Decision

### 两个来源，一份名单

新增 Host 包 `@deepseek-ai/dsh-mcp-manager`（`packages/mcp/mcp-manager`）与客户端包 `@deepseek-ai/dsh-client-ui-settings-mcp`（`packages/client/ui-settings-mcp`）。Web「插件」分区新增 MCP 标签页（order 5，位于「插件配置」与「插件列表」之间）。名单合并两个来源：

- 来自 `mcp-servers` settings 命名空间的设置托管服务器，其 schema 镜像 `dsh-mcp-client` Config 并增加 `enabled` 开关，以 `serverName` 为键——可在标签页内编辑；
- 从 `ctx.loader.entries()` 中投影出的声明式行，模块名为 `@deepseek-ai/dsh-mcp-client`，只读展示（徽标「由配置文件管理」，开关与齿轮禁用）。

管理器为每台启用的设置条目热挂载一个 `dsh-mcp-client` 实例。客户端一实例一台服务器的模型保持不变；其重连 schema 被导出，供管理器复用同一套校验与默认值。

### 持久化与热生效

`mcp-servers` 命名空间经 settings 管线持久化到 `$DSH_HOME/settings.yaml`——schema 校验、revision 围栏、secret 脱敏。管理器监听解析后的分节并对 diff 做对账：新增或重新启用的条目挂载；停用或删除的条目卸载；其余任何字段变更则先卸载再重挂（因为 `dsh-mcp-client` 按 app root 保留 `serverName`，且保留期覆盖 fiber 整个生命周期）。对账在串行队列上执行；停用的条目仍由 gateway 列出，不带状态。

### 命名归属

与声明式行重名的设置条目在写入时即被命名空间的 `validate` 钩子拒绝；`dsh-mcp-client` 自身按 root 的 `serverName` 保留仍是绕过 settings 缝的任何路径在加载期的兜底。

### Secret 处理

`env` 与 `headers` 是 `role('secret')` schema 字段。协议从不回传它们，因此客户端的每次写入都点名它要写的叶子：启用开关写路径 `[serverName, enabled]`；编辑器通过 `SettingsScope.mutate` 一次提交全部变更叶子，留空的 env/headers 字段完全不进入事务。共享 settings scope 同时提供单路径 `setPath` 和原子多路径 `mutate`，因为从脱敏视图重建的整字段写会静默删除已存 secret，而分离事务可能只应用一次编辑的一部分。

### 状态上报

gateway 只上报挂载生命周期（connecting → ready/failed），不上报存活状态：`failOnStartupError: false` 时不可达的服务器仍会激活，`dsh-mcp-client` 在内部重连，因此 `ready` 表示激活已结算，而非服务器应答成功。标签页的状态点文案相应为「运行中／启动失败」。名单与生命周期发生转换后，管理器会广播不带载荷的 `mcp-servers/change` 失效通知；已打开的标签页重新读取，并用请求代际守卫阻止旧响应替换较新的快照。

## Alternatives considered

**从浏览器编辑 cordis.yml。** 写入会落到部署组合的配置文件上，把用户自有状态与部署自有组合混在一起，且每次编辑都需要一次 loader 重载周期。settings 用户层已在组合默认值之上分层，并自带 revision 围栏与 secret 脱敏。

**给 mcp-client 加名单服务。** 管理器是独立关注点——settings、diff、生命周期——`dsh-mcp-client` 一实例一台服务器的形态保持不变；无头调用方可以消费同一 settings 命名空间而不触碰桥接层。

**客户端合并后的整字段写。** 被否决，且正是逐叶子规则所要防范的失败：在脱敏快照上合并、再把整个条目写回，会删除协议从未回传的 `env`/`headers`。逐叶子路径 op 是不经 secret 回程即可保留 secret 的唯一写法。

## Consequences

- 设置与声明式重名在写入时失败（validate 钩子），挂载时也会失败（`dsh-mcp-client` 保留）——两层都高声报错。
- 开关、编辑或删除服务器无需重启 Host 即生效；监督器在 settings 提交时重挂载。
- 添加与编辑表单暴露由 `dsh-mcp-client` 校验的完整自动重连策略。
- 已打开的标签页无需重新挂载浏览器组件，即可收敛到 Host 生命周期变化与连接重置后的状态。
- 留空的 secret 字段表示「保持已存值」；从 UI 清空全部 env/headers 有意不支持——删除后重新添加即可从无 secret 状态开始。
- 状态点上报生命周期而非存活；崩溃循环的服务器在 `dsh-mcp-client` 重试期间持续显示「运行中」，见 [重连 Agent Note](2026-08-06-mcp-client-auto-reconnect.md)。
- 不提供改名：字典键即名称，改名等于删除加新增。

## Testing

- `packages/mcp/mcp-manager`：schema 与重连默认值、注册与写时拒绝、监督器 diff 与挂载/卸载/重挂载、生命周期失效通知、gateway 合并；逐文件 100% 覆盖。
- `packages/client/ui-settings-mcp`：标签页失效通知与旧响应排序、添加/编辑重连字段、控制器原子写入与拒绝处理；100% 覆盖。
- `apps/web/tests/mcp-config.e2e.ts`：真实 scaffold——带重连策略的新增、开关与删除写穿到 `$DSH_HOME/settings.yaml`，并覆盖搜索及 memorix 示例 overlay 下的声明式行；名单与添加表单的 aria golden 位于 `snapshots/mcp-config`。
- `SettingsScope.setPath` 与 `SettingsScope.mutate`：`packages/client/ui-settings/tests/settings-scope.client.spec.ts` 中的单元测试。

## Deferred

- 改名、清空 secret、以及服务器目录或市场。
- 存活状态（相对生命周期状态）需要 `dsh-mcp-client` 提供状态面。
