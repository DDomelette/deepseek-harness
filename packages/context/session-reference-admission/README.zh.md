# @deepseek-ai/dsh-session-reference-admission

[English](README.md) | 中文

宿主插件，在 `agent/pre-step` 把直发消息中的规范 `dsh-session:` 提及接入执行。它以 `prepend: true` 注册，先经 `next()` 委托，再只改写下游决策。

## Public API

- `name = 'session-reference-admission'`
- `inject = ['sessionReferenceResolver', 'sessionQuery']`
- `apply(ctx)` 在 context 生命周期内注册监听器；无配置。

## Behavior

`decision.messages` 中每个满足 `role === 'user'` 且 `source.kind === 'user'` 的条目按内容块调用 `parseSessionReferenceText()`。非文本块原样保留。对有引用的消息，每个源会话的 `cwd` 先经 `ctx.sessionQuery.listSessions()` 与当前会话重查，不一致即抛出。随后 `ctx.sessionReferenceResolver.prepare()` 读取并投影源会话；直发消息替换为 `freezeMessage({ ...message, content: prepared.content })`，保留 id 与 source，`prepared.additionalContext` 插到其正前方。

无引用时原 decision 对象原样返回。malformed 显式提及、源读取失败或预算/上限错误从监听器抛出，agent loop 记录 `turn/end{reason:'error'}`，绝不发送部分上下文。

## Model Experience

### Referenced-session snapshot ordering

#### What the model sees

对提及其他会话的消息，本轮包含 `session-reference` 快照消息及其后的可读直发消息。快照文本由 `@deepseek-ai/dsh-session-reference` 拥有。

#### Token effect

条件且仅追加：被引用会话为每条受理的直发消息增加一条有界快照消息；无提及消息零增加。

#### KV Cache effect

替换后缀从快照消息开始；更早的请求历史保持 append-only。

## Known Limitations and Deferred Work

- **Pre-step 失败会丢弃已认领的直发消息** — 浏览器半在提交前重新校验所选会话，但校验之后的竞态以 turn-error 卡片呈现，而不是 RPC 级 prompt 错误。
- **其他 pre-step 监听器看到原始规范提及文本** — 它们先于这个最外层监听器运行；当前没有监听器依赖该文本。
