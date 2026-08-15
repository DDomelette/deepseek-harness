# @deepseek-ai/dsh-client-ui-session-reference

[English](README.md) | 中文

Web composer 的工作区会话快照引用 `@` source。它把 `InputTriggerSource{ trigger: '@', name: 'session', order: -1 }` 注册到热着的 `ctx.sessions.list` 快照上。

## Behavior

候选是 `cwd` 等于当前会话 `cwd` 的会话，排除当前会话、`blank: true` 行与 `origin: 'subagent'` 行。查询匹配是对 `displayTitle` 与 session id 的大小写不敏感子串；结果保持宿主列表顺序，上限 50。重复标题补充 `description: sessionId`。

选中后插入结构化 `ReferenceInsert`，其中 `ref = sessionId`、`label = displayTitle`、`clipboardText = @[label](dsh-session:<canonical-id>)`。codec 在提交时序列化同一规范提及，标签先取当前列表行，再取 pick 时标签，最后取 session id。列表 ready 且会话缺失时，序列化拒绝，输入机保留草稿。

浏览器编码器是本地 UTF-8 base64url 函数；其输出与宿主编码器逐字节一致。

## Model Experience

### Canonical mention in the direct user message

#### What the model sees

提交的直发消息在 `@deepseek-ai/dsh-session-reference-admission` 改写前包含 `@[label](dsh-session:<canonical-id>)` 文本；快照本身由该宿主插件拥有。

#### Token effect

chip 为直发消息增加一行规范提及；快照 token 由 admission 插件拥有。

#### KV Cache effect

仅追加：提及随新用户消息进入，不重写更早历史。

## Known Limitations and Deferred Work

- **仅严格同 cwd 候选** — 跨工作区交接不在范围内。
- **重复标题用 session id 作为 description** — 没有更丰富的消歧界面。
- **标签可能回退到 session id** — 当会话在 pick 与提交之间离开列表且没有 pick 时标签时。
