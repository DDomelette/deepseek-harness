# @deepseek-ai/dsh-session-flags

[English](README.md) | 中文

DeepSeek Harness 的通用按会话展示标记。Provider 注册其拥有的会话的标记映射；消费者通过 `ctx.sessionFlags` 读取一个合并投影。注册表本身不携带业务含义。

## 服务 API

- `registerProvider(provider)` — 注册一个 `SessionFlagProvider`（`id` 加同步的 `list()`）；返回移除它的 disposer。重复 id 会抛出。
- `snapshot()` — 按注册顺序合并 provider。后面的 provider 在会话和标记键上获胜。返回 `{ flags, complete }`；任一 provider 失败后 `complete` 为 `false`。

## 失败语义

- 失败的 provider 被记录并跳过；成功的 provider 仍会贡献。
- 当所有 provider 都失败且存在先前的完整快照时，返回先前的完整快照。
- 完整快照会成为 last-good 快照。

## 模型体验

无直接影响：本包不注册工具、提示词或会话事件。侧栏工作区浏览器等消费者通过其自身的文档化路径展示标记。

### Token 效果

零直接 token。

### KV Cache 效果

与实时请求无关；本包从不触碰请求前缀。

## 已知限制与暂缓事项

- **没有 provider 变更通知** — 消费者在自身边界拉取 `snapshot()`；独立变化的 provider 必须自行发布事件。
- **没有按标记的冲突策略** — 合并顺序即注册顺序；未来需要类型化冲突处理时要有明确策略。
