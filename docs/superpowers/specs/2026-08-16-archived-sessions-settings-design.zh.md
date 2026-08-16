# 已归档会话设置页设计

Date: 2026-08-16 Status: approved (to implement)

## 背景与目标

DeepSeek Harness 已通过 `ctx.workspaceRegistry.archiveSession()` 和侧栏行菜单归档会话，但没有任何界面列出已归档会话、恢复或删除它们。本设计用“已归档”设置页补齐这个闭环。

目标：

- 新增“已归档”设置板块，按工作区分组，底部为“未分组”组。
- 恢复 = 取消归档该会话、打开它并关闭设置页。
- 删除 = 带二次确认的永久递归删除。
- 以插件形式交付；设置壳与侧栏壳保持不变。

## 已确认的关键决策

1. 删除是永久且递归的：目标及其后代子代理会话自底向上删除；任何已附加会话都会在任何删除发生前被拒绝。契约遵循[已定删除设计](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md)。
2. 恢复会取消归档并立即打开会话，与 Codex 行为一致。
3. 没有工作区记账的已归档会话在底部“未分组”组中展示。
4. 功能以新 host 插件 `dsh-session-deletion` 和新 client 插件 `dsh-client-ui-settings-archived` 交付。既有领域只获得其状态本就拥有的最小扩展。
5. 成熟化处理：删除确认显示后代数量，运行中的会话不能删除，分组保留工作区与会话顺序，页面具有明确的加载、空与错误状态及 i18n。

## 架构

| 包 | 变更 | 职责 |
| --- | --- | --- |
| `@deepseek-ai/dsh-session-persistence` | 扩展 seam | 新增 `delete(id)`、`deleteStored` 后端钩子和 `session-persistence/deleted` 事件。 |
| `@deepseek-ai/dsh-session-persistence-jsonl` | 扩展后端 | 删除会话工件，包括两种物理编码。 |
| `@deepseek-ai/dsh-session-persistence-sqlite` | 扩展后端 | 在单个事务中删除 `sessions` 与 `events` 行。 |
| `@deepseek-ai/dsh-session-deletion` | 新 host 插件 | 提供 `ctx.sessionDeletion`：运行中检查、后代闭包、自底向上删除和幂等续跑。 |
| `@deepseek-ai/dsh-workspace` | 扩展领域 | 新增 `unarchiveSession(id)` 与 `forgetSession(id)`。 |
| `@deepseek-ai/dsh-host-apiproxy` | 扩展网关 | 新增 `session.delete` 与 `workspace.unarchiveSession`、`host/session-deleted` 帧，以及 `session.list` 中无 cwd 的归档会话行。 |
| `@deepseek-ai/dsh-client-runtime` | 扩展服务 | 新增 `ctx.sessions.deleteSession()`、`ctx.workspaces.unarchiveSession()` 和公开的 `refresh()` 方法。 |
| `@deepseek-ai/dsh-client-ui-settings-archived` | 新 client 插件 | 注册“已归档”`settings.section` 页面，并拥有其渲染、操作、文案与错误。 |
| `@deepseek-ai/dsh-web-app` | 扩展 bundle | 挂载两个插件并增加包依赖。 |

新包遵循 [packages/AGENTS.md](../../../packages/AGENTS.md) 的包检查清单与 [adding-a-package.md](../../../docs/cookbook/adding-a-package.md) 的包 README 要求：tsconfig 聚合面、`dsh.client` 清单、invariant 导出和双语 README。

## 数据流

页面从两个既有基线派生分组。不引入新的列表 RPC。

```text
session.list（含已归档 + title projection）
        ×
workspace.list（workspace 顺序、sessionIds 记账、archivedSessionIds）
        ↓
deriveArchivedGroups(sessions, workspaces)
```

派生规则：

- 分组顺序遵循 workspace registry 顺序；只有含已归档行的组才渲染。
- 组内行遵循 workspace 的 `sessionIds` 顺序。
- 所有工作区记账之外的已归档 id 组成底部“未分组”组，按 `updatedAt` 倒序。
- 每行显示 `displayTitle`：持久标题，其次 cwd basename，最后会话 id。
- 当冷会话的 id 已归档时，`session.list` 保留其无 cwd 会话，使其落入“未分组”而不是变得不可见。

## 操作契约

### 恢复

- 行状态：`idle → restoring → idle`。
- 成功：`workspace.unarchiveSession` 提交完整归档集，随后 `ctx.sessions.open(id)`，再通过 `close()` 关闭设置页。
- 若取消归档后目标已从 `session.list` 消失，则留在本页而不打开它。
- 失败：该行保持可见并显示行内 `role="alert"` 错误，可重试。
- 运行中的已归档会话可以恢复。

### 删除编排

`session.delete({ sessionId, recursive })` 委托给 `ctx.sessionDeletion`。已归档页始终传 `recursive: true`：

1. 从 `sessionPersistence.list()` 与 `ctx.sessions` 解析目标。
2. 由 live 与持久化 header 计算 `parentSessionId` 传递闭包。
3. 当任一成员已附加时，以 `session-running` 拒绝整个级联。
4. 当 `recursive` 为 false 且存在后代时，以 `session-has-descendants` 拒绝。
5. 在第一次破坏性写入前，把完整删除计划持久化到 `session_deletion` domain；每个成员的 persistence/workspace 状态迁移在下一步操作前落盘。
6. 先删叶子再删根；重试读取既有计划，而不是从剩余日志重新推导 lineage。
7. 成员执行删除时已 NotFound：标记为 `missing` 后仍执行 `workspaceRegistry.forgetSession(id)`。
8. 活动计划成员的 `session/created` 事件回滚 attach，封住 running-check 与 live 生命周期之间的 TOCTOU。
9. 响应 `deletedSessionIds`；网关发布 `host/session-deleted`。

`session-persistence/deleted` 是派生索引的清理信号。工作区变更复用现有 `domain/changed` 帧与 `host/archived-sessions-changed` 快照。永久删除的数据边界是会话持久化日志、workspace 记账与归档集合；Spec 已声明的附件、导出与 feedback sidecar 不保证级联擦除。

### 错误码

| RPC | 错误 | 含义 |
| --- | --- | --- |
| `session.delete` | `session-not-found` | 目标不存在。 |
| `session.delete` | `session-running` | 目标或后代已附加；details 携带 `runningSessionIds`。 |
| `session.delete` | `session-has-descendants` | 未允许递归删除。 |
| `session.delete` | `session-deletion-unavailable` | 未挂载 `dsh-session-deletion` 插件。 |

`workspace.unarchiveSession` 没有业务错误：未知 id 与已取消归档的 id 都返回当前完整归档集。

## UI

```text
<h2> 已归档
<p>  intro
[loading | error+retry | empty | groups]

每组:
  <section>
    <h3> 工作区标题 · N
    <ul>
      <li> ← 一个会话一行
        <span title> displayTitle（超长省略）
        [运行中 tag，仅 running 会话]
        <span actions>
          <button 恢复对话>  IconRefreshOutline16（顺时针箭头）
          <button 删除对话>  IconCloseFill14 + danger 红色
```

- 行操作中恢复在前、删除在后。
- 图标按钮带有 Tooltip 和 `aria-label="恢复对话 {name}"` / `aria-label="删除对话 {name}"`。
- 删除打开共享 `Modal`：标题、警告、已知时的后代数量、红色危险确认按钮与取消。
- 删除进行中时，确认、取消、Esc 和关闭全部禁用；失败时保持 Modal 打开并显示 `role="alert"` 错误。
- 运行中的行禁用删除按钮，带 `aria-disabled` 和“运行中的会话不能删除”提示。
- 列表容器使用 `aria-live="polite"` 播报行数变化。
- 语言命名空间为 `settings.archived`，en/zh 成对：nav、title、intro、empty、loading、loadFailed、retry、group.ungrouped、row.restore、row.delete、row.running、确认标题/正文变体、restoreFailed 与 deleteFailed。
- 板块注册为 `{ name: 'settings.section', id: 'archived', order: 40 }`。

## 测试策略

| 层 | 覆盖点 |
| --- | --- |
| `session-persistence` 共享契约，在 JSONL 与 SQLite 上运行 | 未知 id 拒绝；未物化 intent 取消；与在途 append 串行；已删 id 复用；`session-persistence/deleted`；两种 JSONL 编码；SQLite 原子行删除。 |
| `dsh-session-deletion` | 已附加目标或后代零删除拒绝；闭包解析；叶子到根顺序；部分失败后重跑收敛；工作区/归档清理。 |
| `dsh-workspace` | unarchive 与 forget 幂等、位置保持、未知 id 行为、表失败回滚。 |
| api-proxy 与 carrier | 请求/响应 schema；错误码；`host/session-deleted`；`session.list` 中无 cwd 的归档行；插件未挂载错误。 |
| 客户端运行时 | unarchive 回声；删除移除；stale 帧与重连收敛。 |
| `ui-settings-archived` | `deriveArchivedGroups` 排序用例；加载/空/错误；行布局；恢复打开并关闭；运行中删除禁用；确认文案与后代数量；pending 禁用；无障碍标签。 |
| 装配 web e2e | 侧栏归档、设置中列出、恢复并打开、再次归档、确认递归删除、验证日志与工作区记账消失、刷新并复验。 |

## 范围之外

- 已归档页的搜索、过滤与批量恢复/删除。
- 超出既有 reconcile 范围的附件、导出或 feedback sidecar 级联清理。
- 对侧栏归档入口的改动。
