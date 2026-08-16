# Web 会话引用设计（composer `@` 会话提及）

Date: 2026-08-16 Status: approved (ready for implementation plan)

## 背景与目标

在 Web composer 中输入 `@` 已经会打开 input-trigger 菜单（`@deepseek-ai/dsh-client-ui-input-trigger`），宿主也已经提供跨会话快照服务（`@deepseek-ai/dsh-session-reference`）。本设计为 Web profile 接通这两套机制：输入 `@` 列出当前工作区的普通会话，选中后插入一个 chip，发送消息时把所选会话的有界只读快照注入到当前消息之前。当前消息保留可读的 `@标题` 文本；模型同时看到两条消息和固定的不可信内容警告。

该功能是一对插件，不是核心改动。移除 `packages/bundle/web-app/cordis.patch.yml` 中的三行组合配置即可完全移除该功能。

## 已确认决策

1. **快照引用**——源会话在发送时点读取一次并冻结；之后源会话的变化不影响已投递消息。
2. **严格同工作区候选与准入**——`same-cwd` 同时是候选发现规则与宿主授权边界；候选只显示与当前会话 `cwd` 相同、非 blank、非 `origin: 'subagent'` 且排除自身的会话，admission 在 prepare 前用 `ctx.sessionQuery.listSessions` 重查源会话 `cwd`，不一致即拒绝。
3. **内置且默认启用**——两个插件随 Web bundle 发布，并可通过组合补丁移除。
4. **基于既有 seam 的插件对**——一个宿主 pre-step 准入插件加一个浏览器 `@` source 插件；apiproxy、wire schema、输入状态机与 `InputTriggerCandidate` 契约均不改动。

## 架构与包边界

| 包 | 目录 | 职责 |
|---|---|---|
| `@deepseek-ai/dsh-session-reference-admission` | `packages/context/session-reference-admission` | 宿主半：在 `agent/pre-step` 解析规范提及，调用 `ctx.sessionReferenceResolver.prepare` 并注入快照 |
| `@deepseek-ai/dsh-client-ui-session-reference` | `packages/client/ui-session-reference` | 浏览器半：注册 `@` `session` source，提供候选、插入 chip 并序列化规范提及 |

宿主插件声明 `inject: ['sessionReferenceResolver', 'sessionQuery']`，无配置。浏览器插件声明 `dsh.client`，其中 `inject: ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-input-trigger']`、`platform: 'web'`。

```text
composer "@"
  -> session source candidates from ctx.sessions.list (same cwd filter)
  -> pick inserts a ReferenceInsert chip (ref = sessionId, label = title)
  -> submit expands the chip through codec.serialize into @[title](dsh-session:<id>)
  -> session.prompt carries that text unchanged
  -> agent/pre-step admission parses it and calls resolver.prepare
  -> [session-reference snapshot, readable direct message] enter the step
```

## 候选列表与 chip 数据模型

候选生成是同步且零 RPC 的。source 以 `order: -1` 注册，使其分组排在其它 `@` 分组之前。它读取 `ctx.sessions.list.getSnapshot()`，取得当前会话的 `cwd`；当前会话缺失或无 `cwd` 时返回空候选。它保留 `cwd` 与当前 `cwd` 字符串全等的会话，排除当前会话、`blank: true` 行与 `origin: 'subagent'` 行，并同时保留运行中与空闲会话。查询匹配是对 `displayTitle` 与 `sessionId` 的大小写不敏感子串；结果保持宿主列表顺序（`updatedAt` 倒序），上限 50。

候选显示使用 `displayTitle`（标题，其次 cwd basename，最后 session id）。同一工作区出现重复标题时，这些行补充 `description: sessionId`；其余行不携带 description。chip 标签始终是纯标题。

`InputTriggerCandidate` 没有 id 字段，因此插件维护 `WeakMap<InputTriggerCandidate, SessionSummary>`，由 `candidates()` 填充并在 `onPick()` 中读取。未命中返回 `undefined`，菜单关闭且不插入文本。

`onPick` 返回 `{ insert: { source: 'session', ref: sessionId, label: displayTitle, clipboardText } }`，其中 `clipboardText` 是 `@[displayTitle](dsh-session:<canonical-id>)`。codec 在提交时序列化同一规范提及，标签先取当前列表行，再取 pick 时标签，最后取 session id。复制 chip 因此得到有效提及；粘贴该文本无需 chip 也走同一快照语义。

浏览器编码器是本地 UTF-8 base64url 函数（`TextEncoder` 加 `btoa`，`+/` 映射为 `-_`，去掉填充）。交叉测试把它的输出与宿主 `encodeSessionReferenceUri()` 对 ASCII、中文、引号、反斜杠与换行 session id 逐字节比对。

每次 pick 插入一个 chip。多个 chip 按首次出现顺序收集，既有的 resolver 负责去重、三源上限与自引用拒绝。

## Pre-step 注入与替换

准入插件以 `ctx.on('agent/pre-step', handler, { prepend: true })` 注册。作为最外层，它先调用 `next()`，待所有其他监听器运行后再转换下游决策。它原样返回 `reject` 决策。

对 `decision.messages` 中每个满足 `role === 'user'` 且 `source.kind === 'user'` 的条目，handler 用 `parseSessionReferenceText()` 解析每个文本内容块，并原位保留非文本块。无引用的消息按身份透传。对有引用的消息，handler 先经 `ctx.sessionQuery.listSessions` 校验每个源会话与当前会话 `cwd` 全等，再调用：

```text
prepared = ctx.sessionReferenceResolver.prepare(agent, readableContent, references, signal)
```

当前消息被替换为 `freezeMessage({ ...message, content: prepared.content })`，保留其 id 与 source。`prepared.additionalContext` 插到该替换消息正前方。进入顺序因此是 `[快照, 可读当前消息]`，与 TUI 投递顺序一致。idle `followup` 与运行中 `steer` 走同一条路径。

其他 source 的消息——插件上下文、工具结果、此前的 session-reference 快照——永远不会被扫描，从而防止递归或伪造引用。

## 错误处理、安全与可观测性

| 失败场景 | 行为 |
|---|---|
| 当前会话缺失或无 `cwd` | `session` 组为空；不报错，不猜测工作区 |
| `onPick` 候选身份未命中 | 返回 `undefined`；菜单关闭且不插入文本 |
| 所选会话在提交前离开列表 | `codec.serialize` 在列表 ready 且 id 缺失时拒绝；输入机保留 draft 与 chips 并显示错误 |
| 列表处于非 ready 阶段（reconnect、pending） | codec 放行提交；由宿主裁决 |
| 有效引用但 prepare 失败（源已删除、预算、超过三个、自引用） | admission 抛出；agent loop 记录 `reason: 'error'` 的 `turn/end`，聊天流渲染既有 turn-error 卡片；消息绝不进入模型 |
| 形如 `@[x](dsh-session:%%%)` 的 malformed 显式提及 | 同一 fail-closed 路径；picker 永不产生该文本 |
| 普通正文提到 `dsh-session:` 但负载不是 base64url 形状 | 按既有 parser 视为普通文本 |
| prepare 期间取消 | abort 原样传播；走既有 cancelled/aborted 语义 |

宿主失败选择抛出而不是返回 `{ kind: 'reject' }`，因为 rejected proposal 记录 `reason: 'blocked'` 且没有用户可见原因，而抛出会到达既有 `turn/end` 错误卡片与 `host/agent-error` 中继。

快照复用既有 resolver 的信任边界：发送时点冻结、只读、每源上限 65,536 字节、每消息最多三源、仅投影 direct user 文本、assistant 文本与压缩检查点，并带固定的不可信内容警告。候选发现只暴露侧栏已有元数据；宿主准入对每个源会话重查 `cwd`，跨工作区的规范提及即使手写或粘贴也会被拒绝。只有 `source.kind === 'user'` 消息中的显式规范提及才会触发源读取。

宿主插件记录 malformed 提及与 prepare 失败，包含 session id 与错误码。浏览器 source 复用 input-trigger 的 console 失败记录与输入机提交 notice。v1 不新增遥测。

## 装配与配置

`packages/bundle/web-app/package.json` 新增三个 workspace 依赖。`packages/bundle/web-app/cordis.patch.yml` 在宿主区新增 resolver 与 admission 两行，在浏览器 roster 新增 source 一行：

```yaml
- id: session-reference
  name: '@deepseek-ai/dsh-session-reference'

- id: session-reference-admission
  name: '@deepseek-ai/dsh-session-reference-admission'

- id: ui-session-reference
  name: '@deepseek-ai/dsh-client-ui-session-reference'
```

resolver 对 `maxReferences: 3` 与 `maxReferenceBytes: 65536` 使用默认值；部署通过 resolver 行 config 调整。浏览器 source 的 50 项上限是固定菜单边界，不读取 `candidateLimit`。

两个新包遵循 [packages/AGENTS.md](../../../packages/AGENTS.md) 的 new-package 清单：tsconfig 聚合面、双语包 README 与 invariant 导出。`packages/client/ui-input-trigger/src/client/locales.ts` 为两份字典增加 `session`：`Sessions` 与 `会话`。这是对既有功能包的唯一改动。

## 测试计划

宿主 admission 测试使用 agent-loop testkit 与既有 session-reference fixtures：

1. 无提及时按身份返回原决策。
2. 单提及进入 `[快照, 可读当前消息]`，原 id、source 与图片块保留。
3. 多提及保持首次出现顺序与 resolver 上限。
4. 非 `user` 的 `source.kind` 永不被扫描。
5. malformed 提及、读取失败、自引用与超限输入产生 turn error 且无部分上下文。
6. prepare 期间 abort 遵循取消语义。
7. steering 与 followup 路径产生相同顺序。
8. 下游监听器追加的上下文在改写后保留。

浏览器测试覆盖同工作区过滤、查询与上限、重复标题 description、pick 输出、codec 标签回退、提交前拒绝，以及与宿主 URI 编码器的交叉比对。

Web 集成测试验证 `@` 菜单中的 `会话` 分组、chip 插入、模型请求中快照在可读当前消息之前、发送后源会话不可变，以及禁用三行后功能完整移除。

## 明确排除

- 跨工作区候选与内容搜索。
- 源会话的实时链接、恢复或 fork。
- 引用预览卡、设置开关、共享 URI codec 包与新遥测。
