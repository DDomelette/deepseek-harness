# @deepseek-ai/dsh-client-ui-pinned-sessions

[English](README.md) | 中文

DeepSeek Harness 侧栏的会话置顶浏览器插件。它把置顶栏、行内图钉操作和搜索结果图钉徽标注册到 `@deepseek-ai/dsh-client-ui-workspace` 声明的三个槽位中。

## 槽位注册

- `sidebar.workspaces.pinned` — 项目树上方的置顶列表。分组视图按所属工作区分组；单列表视图渲染为一个列表。没有置顶会话时该区域隐藏。
- `sidebar.workspaces.sessionActions` — 悬停时显示在行 ⋯ 左侧的置顶/取消置顶按钮。
- `sidebar.workspaces.searchResultExtra` — 置顶搜索结果上的蓝色图钉徽标。

## Store 契约

插件拥有一个 root-scope 的 `defineStore` handle：`snapshot`、`ready` 和 `error`。写操作为 `commit`、`optimistic`、`rollback` 和 `fail`。Remote 落盘后用结果替换快照；失败的变更回滚到先前快照。

## 使用的 Remote 方法

`remote.sessionPins.list`、`setPinned`、`reorderGroup` 和 `reorderFlat`。插件在 `connection/reset` 时重新拉取 `list`。

## 语言命名空间

`sessionPins`（zh/en）：pinned、pin、unpin、pinnedBadge、projects、ungrouped。

## 模型体验

### 请求上下文与条件

#### What the model sees

本包没有模型可见界面。插件只渲染 `sidebar.workspaces` 界面，不注册工具、提示词或会话事件。

#### Token 效果

零直接 token。

#### KV Cache 效果

与实时请求无关。

## 已知限制与暂缓事项

- **置顶行只渲染取消置顶操作** — v1 中重命名/分叉/归档仍通过该会话的项目行提供。
- **没有键盘拖拽排序** — 置顶重排仅支持指针拖拽。
