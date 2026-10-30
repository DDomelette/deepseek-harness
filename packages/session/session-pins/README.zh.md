---
description: "本包的配置与行为。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-pins

[English](README.md) | 中文

## 概述

DeepSeek Harness 的会话置顶持久化与 Remote API。插件拥有一个 `session_pins` 存储 domain，并注册一个 `SessionFlagProvider`，把每个置顶会话 id 投影为 `pinned: true`。`WorkspaceRegistry` 把置顶动词委托给本服务，并从本服务投影出 `pinnedSessionIds` 供 `workspace/follow` 流使用，因此 Workspace 置顶命令与本领域不会分叉。浏览器侧通过 Client 持有者经生成的 `remote.sessionPins` 命名空间读取有序快照。


## 目录

- [服务 API](#service-api)
- [持久化形态](#durable-shape)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="service-api"></a>
## 服务 API

`ctx.sessionPins` 暴露 `list()`、`setPinned({ sessionId, pinned })`、`reorderGroup({ groupKey, orderedIds })` 和 `reorderFlat({ orderedIds })`。每次变更先写 domain global，落盘后返回完整的 `SessionPinsSnapshot`。卸载会等待进行中的 domain 打开操作，并在释放域名之前关闭返回的句柄；取消的初始化不会注册标记 provider。`ready` 表示 domain 是否已打开：从 `ctx.get('sessionPins')` 投影本服务的消费方要先读它，因为初始化完成前 `list()` 会抛错。

<a id="durable-shape"></a>
## 持久化形态

- `pinnedSessionIds` — 置顶集合。
- `groupOrder` — 可选的手动顺序覆盖，以工作区 id 或未分组的 `''` 为 key。
- `flatOrder` — 单列表视图覆盖整个置顶集合的完整顺序。最后一次手动排序之后才置顶的会话会追加到末尾，直到某次重排为它指定位置，因此 `flatOrder` 与 `pinnedSessionIds` 始终指向同一批会话。

重排时命名了当前未置顶 id、重复 id，或（单列表）遗漏某个置顶 id，都会在写入前以 `session-pins-invalid` 拒绝。被拒绝的请求不会改变置顶集合及两种已保存的顺序。

<a id="model-experience"></a>
## 模型体验

### 请求上下文与条件

#### What the model sees

本包没有模型可见界面。`sidebar.workspaces` 的展示与搜索排序由客户端置顶插件记录。

#### Token 效果

零直接 token。

#### KV Cache 效果

与实时请求无关；本包从不触碰请求前缀。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **跨进程实时同步暂缓** — 客户端在重连或重启后通过 `list()` 收敛。
- **过期 order key 惰性清理** — 已删除工作区的条目保留到下一次变更。

<a id="dev-note"></a>
### 开发备注

无。

不发布运行时不变量伴随插件。本包在注册或写入处验证输入，不暴露可与独立事件流比对的第二份权威状态。
