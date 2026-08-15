# @deepseek-ai/dsh-session-deletion

[English](README.md) | 中文

DeepSeek Harness 的递归会话删除编排插件。

## 服务

`ctx.sessionDeletion.delete({ sessionId, recursive })` 永久删除一个会话；当 `recursive` 为 true 时，同时删除其后代子代理会话。

## 行为

- 级联成员已附加时，以 `session-running` 拒绝整个删除。
- 存在后代且未允许递归时，以 `session-has-descendants` 拒绝。
- 删除顺序为叶子优先，崩溃后不会留下悬空的父会话。
- 已消失的级联成员会被跳过，保证重跑幂等。
- 每次持久删除后，若挂载了 `workspaceRegistry`，则调用其 `forgetSession(id)`。

## 错误

| 错误 | 含义 |
| --- | --- |
| `session-not-found` | 目标既不是 live 会话也未持久化。 |
| `session-running` | 目标或后代已附加；details 携带 `runningSessionIds`。 |
| `session-has-descendants` | 未允许递归删除。 |

## 模型体验

该插件不注册工具、不注入提示词，也不写入会话事件。

## 限制

- 该服务不会取消运行中的会话；调用方需先取消。
- 删除清理依赖 workspace 插件在存在时已挂载。
