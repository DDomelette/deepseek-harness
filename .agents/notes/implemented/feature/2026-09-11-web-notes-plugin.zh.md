# Agent Note: Web 笔记插件留存素材并在各自会话中逐条作答

Status: implemented

[English](2026-09-11-web-notes-plugin.md) | 中文

## 问题

dsh 会话会产生用户想回看的素材：一段值得翻译的文字、一张值得追问的截图。harness 原本无处存放它。把它复制进另一个会话会让它与无关工作混在一起，而 Web 界面也没有任何地方可以收集、列出或回看一次选区。

这个特性还有两个必须在写代码之前定下的性质：收集来的素材以什么形式存储，以及用哪个机制把它变成模型请求。

## 决策

`@deepseek-ai/dsh-notes` 是一个树内包，同时承载 Web 笔记面板的两个半边。宿主半边在 `ctx.storageDomain` 上拥有 `notes` 存储域、`notes` 设置命名空间，以及每个笔记会话对应的一条真实 dsh Session；浏览器半边拥有面板。收集来的文字与截图先作为素材存储，之后再提交给模型。

### 笔记问答走真实 Session

分析与追问都对一条真实的 dsh Session 调用 `Agent.followup()`。`docs/architecture.md` 把 Model-visible ⟺ logged 定为运行时不变式：凡进入模型请求的内容必须能从会话日志重建。旁路直调 `ctx.llm.stream` 要满足该不变式就得新增 `SessionEventMap` 事件，还要一条把浏览器字节变成 `ImageAttachmentRef` 的宿主 RPC，外加自写的流式转发与渲染。走 Session 则免费得到截图链路、流式输出、模型与权限选择以及日志合规。

### 线程归属记录用户消息 id

一条素材记录它提交过的每条用户消息的 id。归属把这些 id 解析成 seq，并对每条取它之后、下一条用户消息之前的全部事件。追问可能在首次分析很久之后、且在其他素材已被分析之后才到达，因此连续区间会把邻居的事件归到错误的素材上。

匹配的是身份而不是 seq，因为 `Agent.followup(message)` 返回 `void`：消息落进日志的 seq 在调用点不可知，而 `createUserMessage()` 在发送前就铸出了它的 id。记录 seq 就只能靠抢在提交时订阅 `session/event`。

### 两种策略都是提交，追问用笔记会话

`strategy` 决定素材**何时**提交，而不是**如何**提交：`manual` 等待显式分析，`auto` 在收集时提交，两条路径都调用 `followup()`。`agent.inject()` 不是"仅添加"的实现——它把内容停在 inbox，等下一个消息合并进同一次请求，那会把多条素材塌缩成一个回答，破坏"一行对一段输出"的规则。

两个入口都从素材自己的会话记录解析活的 Agent（`Material.noteId` → 记录在案的 dsh Session），而**不是**从 `Material.source.sessionId`——后者指的是素材被收集时所在的会话。用来源会话发追问会把问题投进一个无关的会话。

### 并发的分析在域的写链上认领素材

分析是幂等的，而强制这一点的检查是域的原子读-改-写，而不是发送前的一次同步 `get`。两个调用者可能都看到空的 `messageIds`；只有 transform 先执行的那个会记录自己的 id，后到者在返回的记录里看到该 id，便不再提交。普通的"先检查再发送"会让一次双击把同一素材发送两次。

铸造素材顺序值的操作（`create`、`restore`、`reorder`）出于同样原因串行排在一条会 settle 的队尾之后。顺序值来自对内存表的同步读取，而尚未落地的兄弟写入不会体现在其中，因此两次并发创建会铸出相同的顺序值，丢掉"最新置顶"规则。队尾在拒绝时也会 settle，所以一次被拒的 `reorder` 不会卡住它后面的操作。

### 最后一个笔记会话不可归档

`ctx.notesSessions.archive` 拒绝归档最后一个未归档会话。面板永远拥有一个可显示的会话，而浏览器半边不能是唯一强制这件事的地方：spec 把规则放在归档动作上，直接调用者会绕过被隐藏的按钮。

### 新会话加入部署的默认 preset

`NoteSessions.create` 通过 `ctx.agents.create` 启动一条真实 dsh Session，工作区与模型取自设置节。拥有 agent 注册表的那一行也可能挂载 preset roster，而在那种部署里，不入伙任何一个 preset 的新会话会是一个空世界——没有工具、没有 prompt 片段——因为面向模型的行是按 preset 分发的。因此该服务可选地解析 `agentPresets`：有 roster 时，把它的默认 id 记进 `meta.agentPreset`，并在创建期的 `setup` 回调里挂载它。没有 roster 时，面向模型的行留在 host 平面、由注册表从全局层读取，headless bundle 就是这样。

配置好的工作区是必需的：没有工作区的会话无处运行，所以 `create` 以具名错误拒绝，而不是随手挑一个。agent handle 不被保留——创建上下文就是本服务的 fiber，因此卸载插件会释放它启动的每个会话；记录失败时会释放刚创建的 agent，而不是让它毫无记录地继续运行。

### 由一个服务打开笔记域

`ctx.storageDomain.open` 对同一个域名只允许一次打开。因此 `ctx.notesStore` 是唯一所有者：它在自己的 `[Service.init]` 里打开域，把关闭绑到自身 fiber 的 effect 上，并暴露素材表、会话表与面板的活动指针。素材存储、会话记录与设置所有者读取这些句柄，而不是去开第二个域。

### 线程归属按纯函数测试

`src/thread.ts` 除了它读取的事件形状（`seq`、`type` 与 `data.id`）之外不依赖任何东西，因此归属规则由手写的事件列表钉住，而不需要驱动一条活的 Session。同一形状也能读持久化日志，所以该规则在重启后照常成立，无需额外路径。

## 依赖策略例外

已发布的依赖策略要求对经过评审的 safe 导出分类使用专门的标题。本次改动往 `scripts/package-dependency-policy.ts` 的 `SAFE_HOST_DEPENDENCY_EXPORTS` 加了三个导出，均在加入前经仓库所有者批准：

- `@deepseek-ai/dsh-llm#createUserMessage` —— 由输入与一个新的 `randomUUID()` 构造冻结消息，没有模块级状态。
- `@deepseek-ai/dsh-storage-domain#defineDomain` —— 校验 spec 的名称、版本、layout 与 global schema 后返回它。
- `@deepseek-ai/dsh-storage-domain#domainTable` —— 由参数返回 `{ valueSchema }`。

notes 包声明了 `dsh.client`，因此策略会检查它宿主半边引入的每一个运行时导出。这三个值都只是纯数据构造，所以第二份安装副本产出的值第一份也接受。

## 曾考虑的替代方案

**直接调用 `ctx.llm.stream` 并在面板里渲染流。** 否决：Model-visible ⟺ logged 不变式会要求新增会话事件，而截图链路、附件引用、流式传输与模型选择都得重建。走 Session 复用了它们全部。

**为"仅添加"策略使用 `agent.inject()`。** 否决：`inject` 把滞留内容合并进下一个被 admitted 的请求，因此在任何发送之前收集的两条素材会被一起作答。一行对一段输出要求每条素材各占一个 step。

**记录每条已提交消息的 seq 而不是它的 id。** 否决：`followup()` 返回 `void`，seq 只有在提交时抢 `session/event` 才能观测到，而重启后的进程无法重建某条素材的消息落在哪个 seq。

**把面板拆成宿主包加 `packages/client/ui-notes` 包。** 本阶段否决：`packages/client/AGENTS.md` 要求每个 `packages/client/*` 包的 node 半边都是空 `apply`，因此沉重的宿主半边不能放在那里，而拆分还会引入一条当前没有消费者的跨包 Remote 消费路径。单包双半边沿用 `packages/session-query/session-log-export` 的先例。

**让每个服务各自打开笔记域。** 否决：设施对同一域名只允许一次打开，因此第二次 `open` 会以 `already-open` 拒绝。共享所有者还带来唯一的关闭点，且排在每个注入它的消费者之后。

**在设置 schema 里把缺省的工作区与模型覆盖建模为 `null`。** 依据库的语义否决：schemastery 把 `null` 默认值解析为"没有默认值"（`Schema.resolve`），因此可空字段无法把 `null` 作为默认值。schema 让两者都缺省，访问器向消费者报告 `null`。

**给模型覆盖用裸对象 schema。** 否决：`s.object()` 总以 `{}` 为默认值，接着它自己的必填字段校验失败，所以缺省的覆盖无法表达。schema 把该对象包在单成员 union 里，既保持覆盖可缺省，又仍然严格校验存在的那一个。

## 影响

面板的浏览器半边是另一个阶段，而承载它的 Remote 命名空间尚未构建，因此宿主半边目前还没有浏览器消费者。本阶段存储的素材只有文字：记录带有附件引用字段，但没有任何东西把图片写进去。

素材正文与每个模型回答都活在会话事件里，因此插件域保持很小，素材内容从不复制。这也意味着读取某条素材的回答需要会话日志，而作答需要一条活的 Session：进程重启过的会话会以具名错误拒绝，直到它被重新打开，因为 `ctx.agents` 只持有活的 Agent。

发送被拒时会回滚已记录的消息 id 并把素材标记为 `failed`。没有这个回滚，`analyse` 会把素材读成"已提交"，它就永远无法重试。

排序操作排在一条会 settle 的队尾之后逐个执行，因此一串连续收集会按调用顺序写入素材，代价是它们被串行化；每个操作只做一次表写入，所以在面板规模下这个队列不构成吞吐问题。

取回已归档会话时，它回到自己的创建位置而不是列表顶部，因为 `NoteSessionRecord` 没有顺序值；素材则会置顶，靠的是 `create` 与 `restore` 都会铸在全部可见兄弟之前的显式 `order` 值。

## 测试

`packages/notes/notes/tests/` 以逐文件 100% 覆盖率覆盖宿主半边：真实存储栈上的域、素材排序与归档、会话记录与活动指针、按配置的工作区与模型创建会话（含加入 preset roster 与记录失败时释放 agent）、线程归属、正文组装、内存 provider 上的设置节，以及针对替身 agent 注册表的分析编排。

`notes-composition.host.spec.ts` 是 `packages/AGENTS.md` 对产品可见插件要求的非单测组合测试：它通过真实 Loader 启动一个测试专属的 `cordis.yml`，断言裸 `notes` 行到达 active、该行对外提供的正是 schema 默认值，以及卸载该行会释放域名。它等待服务发布而不是等 `loader.await()`，因为行的 fiber 会在它 `apply` 挂载的服务完成异步初始化之前就 settle。它的 `agents` 行是一个兄弟 Loader 行而不是 root 级 provide，因此该 spec 走的是与线上组合相同的解析路径。

## 相关

- [notes 设计记录](../../../../docs/superpowers/specs/2026-09-11-dsh-notes-design.md) —— 可行性勘察结论、数据模型与四阶段改动清单。
- [Phase 0-1 实现计划](../../../../docs/superpowers/plans/2026-09-11-dsh-notes-host-core.md) —— 本阶段遵循的任务分解。
