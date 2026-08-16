# 会话置顶设计

日期：2026-08-16 状态：已批准（待实现）

## 背景与目标

DeepSeek Harness 侧栏工作区浏览区由 `@deepseek-ai/dsh-client-ui-workspace` 整体注册到 `sidebar.workspaces` 槽位，当前没有置顶会话的能力。本设计在侧栏顶部新增「置顶」栏，在会话行 ⋯ 菜单左侧新增图钉按钮，并以独立插件交付。

目标：

- 置顶后会话从项目栏移出，只出现在顶部置顶栏，置顶栏按所属项目分组。
- 某项目组全部会话置顶后，项目栏仍保留项目组标题和 ＋ 新建按钮。
- 置顶顺序默认保留项目原有顺序，支持置顶栏内手动拖拽，取消置顶后回到原位。
- 置顶栏跟随「按工作区 / 单列表」视图切换。
- 搜索时隐藏置顶栏，置顶匹配结果优先并带蓝色图钉。
- 置顶栏与项目栏交互一致：不悬停显示时间，悬停显示图钉和 ⋯。
- 无任何置顶会话时隐藏置顶栏。

## 已确认的关键决策

1. 置顶集合持久化在插件私有 domain `session-pins`，不经 session log，也不写入工作区账号顺序。
2. 手动拖拽顺序是可选覆盖：分组视图按 `groupOrder[groupKey]`，单列表按 `flatOrder`；无覆盖时使用对应视图的默认顺序。
3. 取消置顶只删除置顶记录，项目 `workspace.sessionIds` 顺序从未被修改，因此会话回到原位。
4. 已归档或不可见的会话保留持久化置顶记录，但所有 UI 投影先过滤不可见会话。
5. 单进程写入；跨进程实时同步不在 v1 范围，重连或重启后通过 `list()` 收敛。
6. 功能由两个新插件交付；核心只增加通用标记接口和通用槽位，不包含置顶业务。

## 架构

| 包 | 变更 | 职责 |
| --- | --- | --- |
| `@deepseek-ai/dsh-session-flags` | 新 host 包 | 通用会话标记接口：`SessionFlags { pinned?: boolean }`、`SessionFlagProvider` 注册契约、合并投影与 `ctx.sessionFlags`。默认无 provider 时投影为空。 |
| `@deepseek-ai/dsh-session-pins` | 新 host 插件 | 打开 `session-pins` domain；注册 `SessionFlagProvider`；以 `TypertRemoteService` 暴露 `remote.sessionPins`。 |
| `@deepseek-ai/dsh-client-ui-pinned-sessions` | 新 client 插件 | 维护置顶快照 store；注册置顶栏、行内图钉和搜索徽标三个槽位。 |
| `@deepseek-ai/dsh-workspace` / `@deepseek-ai/dsh-host-apiproxy` | 扩展 | `workspace.list` 响应增加 `sessionFlags`；schema 与客户端 `WorkspaceListState` 同步增加。 |
| `@deepseek-ai/dsh-client-ui-workspace` | 扩展槽位 | 声明并渲染三个通用槽位；从 `sessionFlags` 过滤项目树并对搜索结果排序。 |
| `@deepseek-ai/dsh-web-app` | 扩展 bundle | 挂载两个新插件并增加包依赖。 |

新包遵循 [packages/AGENTS.md](../../../packages/AGENTS.md) 与 [adding-a-package.md](../../../docs/cookbook/adding-a-package.md)。

### 新增槽位

| 槽位 | 类型 | 渲染位置 | owner 传入 |
| --- | --- | --- | --- |
| `sidebar.workspaces.pinned` | single | 浏览态列表区域顶部、项目树上方，同一滚动容器 | `{ wide, view }` |
| `sidebar.workspaces.sessionActions` | list | 每个非空白会话行 ⋯ 菜单左侧 | `{ sessionId, flat, blank }` |
| `sidebar.workspaces.searchResultExtra` | list | 搜索结果标题行右侧 | `{ sessionId }` |

置顶栏组件、图钉按钮、搜索结果蓝色图钉均由 client 插件注册；`ui-workspace` 不渲染置顶 UI。

## 数据模型

`dsh-session-pins` 通过 `defineDomain` 打开 `session-pins` domain：

```ts
global: {
  pinnedSessionIds: SessionId[]            // 置顶集合，无顺序含义
  groupOrder: Record<string, SessionId[]>  // 分组视图手动顺序覆盖，key = workspaceId 或 ''（未分组）
  flatOrder: SessionId[]                   // 单列表手动顺序覆盖
}
```

默认顺序：分组视图取 `workspace.sessionIds` 原有顺序；单列表取项目栏 recency 顺序。渲染时忽略未知或已取消置顶的 id；工作区删除后其覆盖 key 不再命中，置顶会话按未分组默认顺序显示，下一次 mutation 惰性清理过期 order key。

### Remote API

| 方法 | 入参 | 返回 |
| --- | --- | --- |
| `list()` | — | `SessionPinsSnapshot` |
| `setPinned({ sessionId, pinned })` | 置顶或取消 | 更新后的 `SessionPinsSnapshot` |
| `reorderGroup({ groupKey, orderedIds })` | 组内拖拽结果 | 更新后的 `SessionPinsSnapshot` |
| `reorderFlat({ orderedIds })` | 单列表拖拽结果 | 更新后的 `SessionPinsSnapshot` |

每次 mutation 先写 domain、后返回完整快照；非法或未知 id 返回 `session-pins-invalid` 且不写盘。

### 通用标记投影

`ctx.sessionFlags.snapshot()` 合并所有 provider：同一会话同一字段按 provider 注册顺序后者覆盖。`dsh-session-pins` 把 `pinnedSessionIds` 投影为 `{ [id]: { pinned: true } }`。`workspace.list` 携带该快照，客户端从 `useWorkspaces()` 读取。

## UI 行为

- 置顶栏只在 `searchActive === false` 时渲染；全局无置顶时组件返回 `null`。
- 分组视图只渲染含置顶会话的项目组；单列表渲染全部置顶会话。
- 项目树过滤 `pinned: true` 会话；空项目组保留标题、计数 0 和 ＋ 按钮，并显示「暂无未置顶会话」。
- 搜索时置顶栏不渲染；置顶匹配结果排在最前，组内仍按 recency 稳定排序。
- 图钉按钮和 ⋯ 只在行悬停时出现，不悬停显示时间；空白 New Session 行没有图钉、时间和菜单。
- 分组拖拽仅组内，单列表拖拽可跨项目；拖拽只写置顶顺序覆盖。
- 选中态、状态点、运行中/待审批提示和 hover 卡片沿用现有会话行组件。

文案命名空间为 `sessionPins`（zh/en）：置顶、取消置顶、暂无未置顶会话、置顶会话优先。图钉按钮带 `aria-label` 和 tooltip。

## 错误与边界

| 场景 | 行为 |
| --- | --- |
| Remote 失败 | 客户端回滚乐观更新，行保持原状态。 |
| domain 写失败 | mutation reject，不产生内存与磁盘不一致。 |
| provider 抛错 | `ctx.sessionFlags` 保留 last-good 快照；从未成功过时返回空映射，项目树完整。 |
| 插件未启用 | 三个槽位为空、`sessionFlags` 为空，侧栏恢复现有行为。 |
| 会话已归档 | 置顶记录保留，UI 不显示该会话。 |
| 当前会话被置顶或取消 | 选中高亮随会话移动到置顶栏或项目栏。 |
| rail 折叠 | 置顶栏随浏览区整体隐藏。 |

## 测试

- `dsh-session-pins`：domain 初始化、pin/unpin、两种 reorder、非法输入不写盘、provider 投影。
- `dsh-session-flags`：注册/卸载、合并覆盖、last-good 失败语义。
- `dsh-client-ui-pinned-sessions`：store 初始化、乐观更新与回滚、三槽位注册、分组/单列表渲染、空态隐藏。
- `ui-workspace`：`deriveGroups` / `deriveFlat` / `deriveSearchResults` 的过滤与排序，空项目组保留，搜索置顶优先。
- E2E：悬停置顶、刷新持久化、拖拽排序、取消回到原位、视图跟随、搜索置顶优先、全组置顶后 ＋ 保留、无置顶隐藏、插件禁用恢复原样。
- 本改动是用户可见 GUI 行为，PR 附带真实服务器录制的 GIF 演示；实施阶段用 `dsh-pre-push-checks` 选择最小覆盖测试集。

## 非目标（v1）

- 跨进程或多标签页实时同步置顶。
- 批量置顶、置顶栏独立折叠、键盘拖拽排序。
- 置顶会话的跨设备云同步。
