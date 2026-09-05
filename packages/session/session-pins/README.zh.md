---
description: "本包的配置与行为。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-pins

[English](README.md) | 中文

## 概述

DeepSeek Harness 的会话置顶持久化与 Remote API。插件拥有一个 `session_pins` 存储 domain，并注册一个 `SessionFlagProvider`，把每个置顶会话 id 投影为 `pinned: true`。侧栏功能通过 `workspace.list.sessionFlags` 消费标记，并通过生成的 `remote.sessionPins` 变更置顶。


## 目录

- [服务 API](#service-api)
- [持久化形态](#durable-shape)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="service-api"></a>
## 服务 API

`ctx.sessionPins` 暴露 `list()`、`setPinned({ sessionId, pinned })`、`reorderGroup({ groupKey, orderedIds })` 和 `reorderFlat({ orderedIds })`。每次变更先写 domain global，落盘后返回完整的 `SessionPinsSnapshot`。

<a id="durable-shape"></a>
## 持久化形态

- `pinnedSessionIds` — 置顶集合。
- `groupOrder` — 可选的手动顺序覆盖，以工作区 id 或未分组的 `''` 为 key。
- `flatOrder` — 单列表视图的可选手动顺序覆盖。

重排时命名了当前未置顶 id、重复 id，或（单列表）遗漏某个置顶 id，都会在写入前以 `session-pins-invalid` 拒绝。

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
