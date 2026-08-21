# @deepseek-ai/dsh-session-deletion

[English](README.md) | 中文

DeepSeek Harness 的递归会话删除编排插件。

## 服务

`ctx.sessionDeletion.delete({ sessionId, recursive })` 永久删除一个会话；当 `recursive` 为 true 时，同时删除其后代子代理会话。

该服务依赖 `storageDomain`，为每个 root id 保存一条 `session_deletion` 计划。

## 行为

- 在第一次破坏性写入前，完整删除计划已持久化。
- 重试读取计划，而不是从剩余日志重新推导 lineage。
- 级联成员已附加时，以 `session-running` 拒绝整个删除。
- 存在后代且未允许递归时，以 `session-has-descendants` 拒绝。
- 删除顺序为叶子优先，崩溃后不会留下悬空的父会话。
- 已消失的成员标记为 `missing`，并且仍会执行 workspace 清理。
- 每个成员状态迁移都会在下一步操作前持久化。
- 针对活动计划成员的 `session/created` 会回滚 attach。

## 错误

| 错误 | 含义 |
| --- | --- |
| `session-not-found` | 目标既不是 live 会话也未持久化，并且没有计划。 |
| `session-running` | 目标或后代已附加，或在删除期间被附加；details 携带 `runningSessionIds`。 |
| `session-has-descendants` | 未允许递归删除。 |

## 模型体验

### 请求上下文与条件

#### What the model sees

本包没有模型可见界面。`ctx.sessionDeletion` 服务不注册工具、不注入提示词，也不写入会话事件。

#### Token 效果

零直接 token。

#### KV Cache 效果

与实时请求无关。

## 已知限制与暂缓事项

- 该服务不会取消运行中的会话；调用方需先取消。
- 仅当未挂载 `workspaceRegistry` 时才跳过 workspace 清理。
