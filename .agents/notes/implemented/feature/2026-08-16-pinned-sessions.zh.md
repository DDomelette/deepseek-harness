# Agent Note: pinned sidebar sessions

Status: implemented

[English](2026-08-16-pinned-sessions.md) | 中文

## Problem

侧栏工作区浏览器没有把重要对话固定在项目树上方的能力。用户只能按项目归属和最近活动查找会话，高频访问的会话可能被更新的活动不断挤下去。

## Decision

`@deepseek-ai/dsh-session-flags` 提供通用的宿主侧展示标记注册表（`ctx.sessionFlags`）。Provider 注册同步标记映射；`workspace.list` 携带合并后的 `sessionFlags` 投影，使客户端工作区 store 保持纯展示。

`@deepseek-ai/dsh-session-pins` 拥有会话置顶能力。它持久化一个 `session_pins` storage-domain global：`pinnedSessionIds`、按工作区的 `groupOrder` 覆盖，以及单列表的 `flatOrder` 覆盖，并暴露 `remote.sessionPins` 的 `list`、`setPinned`、`reorderGroup` 和 `reorderFlat`。每次变更先写 domain，再返回完整快照。重排命名了未知、未置顶或重复 id 时，在写入前以 `session-pins-invalid` 失败。同一插件注册唯一的 flag provider，投影 `pinned: true`。

`@deepseek-ai/dsh-client-ui-pinned-sessions` 把用户可见界面注册到 `@deepseek-ai/dsh-client-ui-workspace` 声明的三个槽位中：

- `sidebar.workspaces.pinned` 在项目树共享滚动列表内渲染置顶区域。分组视图按所属工作区分组；单列表视图渲染为一个列表；没有置顶会话时该区域隐藏。
- `sidebar.workspaces.sessionActions` 渲染行 ⋯ 左侧仅悬停可见的图钉按钮。
- `sidebar.workspaces.searchResultExtra` 渲染搜索结果上的置顶徽标。

`ui-workspace` 从分组树和单列表中过滤 `pinned: true` 会话，在全组置顶时保留项目组标题和新建会话入口，并把置顶搜索匹配排在最前。置顶顺序默认为项目账号顺序（分组）或 recency（单列表），可通过拖拽覆盖；项目账号顺序从不被改写，因此取消置顶会恢复原位。

## Alternatives considered

- **Settings 命名空间持久化** — `pinnedSessions` settings 命名空间可以复用 settings 线路和文件，但 settings 的 revision/冲突机制面向配置，不适合高频书签变更，而且它无法让会话列表拥有宿主权威投影。
- **直接内置于 ui-workspace** — 最快实现，但会把展示状态和领域持久化耦合进一个包，使能力无法独立禁用。
- **仅客户端 localStorage** — 最简单，但置顶无法跨浏览器、配置文件或存储清理存续，宿主投影也会天然陈旧。

## Consequences

- 核心增加了一个通用标记接缝和三个工作区槽位；置顶能力保持可独立挂载。
- 搜索结果和项目树现在读取标记投影；provider 失败时保留 last good 完整快照，或退化为空投影。
- 跨进程实时置顶同步暂缓：客户端在重连或重启后通过 `list()` 收敛。
- 置顶行只渲染取消置顶操作；重命名/分叉/归档仍保留在该会话的项目行上。

## Testing

宿主 domain 与 Remote 行为由 `packages/session/session-pins/tests/session-pins.spec.ts` 固定；标记合并由 `packages/session/session-flags/tests/session-flags.spec.ts` 固定；工作区标记投递由 `packages/host/apiproxy/tests/api-proxy-workspace.spec.ts` 固定；树过滤、空组和搜索排序由 `packages/client/ui-workspace/tests/tree.client.spec.ts` 固定；客户端注册和 store 回滚由 `packages/client/ui-pinned-sessions/tests` 固定。
