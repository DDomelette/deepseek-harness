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

`NoteSessions.create` 通过 `ctx.agents.create` 启动一条真实 dsh Session，工作区与模型取自设置节。会话的路由在设置节带有模型覆盖时就是该覆盖，否则是部署的默认模型选择（`ctx.agentDefaultModel`）——与其他每个创建型入口读的是同一个默认值——并作为 `agentOptions` 传给创建，因为创建时没有路由的 agent 在它的第一个请求上就没有路由。拥有 agent 注册表的那一行也可能挂载 preset roster，而在那种部署里，不入伙任何一个 preset 的新会话会是一个空世界——没有工具、没有 prompt 片段——因为面向模型的行是按 preset 分发的。因此该服务可选地解析 `agentPresets`：有 roster 时，把它的默认 id 记进 `meta.agentPreset`，并在创建期的 `setup` 回调里挂载它。没有 roster 时，面向模型的行留在 host 平面、由注册表从全局层读取，headless bundle 就是这样。

配置好的工作区是必需的：没有工作区的会话无处运行，所以 `create` 以具名错误拒绝，而不是随手挑一个。agent handle 不被保留——创建上下文就是本服务的 fiber，因此卸载插件会释放它启动的每个会话；记录失败时会释放刚创建的 agent，而不是让它毫无记录地继续运行。

### 由一个服务打开笔记域

`ctx.storageDomain.open` 对同一个域名只允许一次打开。因此 `ctx.notesStore` 是唯一所有者：它在自己的 `[Service.init]` 里打开域，把关闭绑到自身 fiber 的 effect 上，并暴露素材表、会话表与面板的活动指针。素材存储、会话记录与设置所有者读取这些句柄，而不是去开第二个域。

### Remote 操作回报拒绝，而不是抛异常

`notes` Remote 命名空间对每次调用都以 `src/types.ts` 里的词汇作答：有值时是 `NotesSuccess<T>`，被拒时是 `code` 指明条件的 `NotesRejected<E>`。跨 wire 的调用者看不到异常类型，而面板必须在引发它的那一行旁边解释这次拒绝，因此每条规则都作为谓词暴露在拥有它的服务上——`NoteSessions.hasWorkspace`、`NoteSessions.canArchive`、`Materials.isVisible`——强制该规则的方法读取的正是同一个谓词。`Analysis.analyse` 与 `Analysis.ask` 返回它们本来会抛出的失败，因为把失败报告出来正是其调用者的全部职责。于是强制点仍然落在做出决定的那个操作里，浏览器永远不持有宿主不会执行的规则。

`materialUpdate` 拒绝已经进入会话的素材（`material-submitted`）：提交过的正文由会话日志承载，改写记录里的文本会让列表行与它的线程脱节。`materialAsk` 拒绝相反的状态（`material-not-submitted`）：草稿没有线程，否则这次追问会被报成已提交，而实际上什么都没有发出去。

### 面板是一个只经 Remote 命名空间读取的页签类型

浏览器半边向 `ctx.sidebarRightTabs` 注册一个页面类型——kind 为 `notes`、处在 `builtin` 档、不识别任何资源地址——并从 keyed 座位 `sidebar.right.pane.tab` 上、以该定义自己的 `id` 绘制它，因此扩展可以接管这个 kind 而不必接管正文。对话标题栏 `conversation.session.header.corner` 座位上的控件按 kind 打开页签；`openTab` 会在同一窗格内去重页面，所以再次按下只是显示面板而不是新增一个，控件本身不需要任何状态。

面板访问宿主只经 `ctx.remote.notes`，别无他途：它从不伸手拿服务，也不持有任何宿主不会执行的规则。读取与它下达的两次写入都在 `src/client/face.ts` 里跑，写入的是注册所声明的那份 store；组件只渲染 store 持有的内容并调用这些命令，因此拒绝是要画出来的状态而不是要捕获的异常。不指明任何笔记条件的 carrier 失败会变成一条本地状态 `remote-unavailable`，带着传输自己的消息；被拒的写入在它没有推翻的内容旁边报告，而只有读取失败才替换内容。

面板在窗格够宽时排成两栏，低于 560px 时只排一栏；这个切换是对面板自身而非窗口的 container query——右列的宽度不是视口的宽度。第二个 500px 阈值会收起导航控件的文字，使窄窗格保住每一个控件而不是丢掉带文字的那些。它的可编辑性跟随宿主的规则而不是靠猜：wire 摘要带上由素材已记录消息 id 派生的 `submitted`，因此正文恰好在素材还是草稿时可编辑，追问输入框则恰好从它不再是草稿时起绘制。行上的动作标签与详情里的模板回显用的是设置节对素材所命名动作的原文，因此面板在打开时就读该节，而不是等设置卡；配置已经丢弃的动作会退回显示存下的 id，并且不回显任何模板。导航栏的会话胶囊列出全部会话（含已归档），因为笔记会话从不被删除：选中已归档的那条会把它取回，而两个选择背后的操作早已存在于该命名空间上。

浮窗与停靠是右列的呈现，不是面板自己的：`ui-sidebar-right` 早已能把一个页签浮出成面板并停靠回去，浮窗还带自己的标题栏。面板需要的是知道自己处在哪种呈现里，因此 `SidebarRightTabInfo.panel` 带上 `floating`——这是页签自己的呈现控件无法推导出的唯一事实——该控件通过与打开面板同一个面去调用框架的 `float`/`dock`。

设置卡是面板的第二个写入面，它写向组装入口读取的同一处：`notes/settingsUpdate` 经 `ctx.settings` 合并进笔记设置节，而被请求命名为 null 或干脆省略的字段会被取消，而不是存成 null，因为该节的 schema 用"字段不存在"表达缺省的工作区或模型覆盖。因此清空一个字段与把它交还给部署默认值是同一个操作，浏览器里也不会存在第二份默认值。

### 标题栏角落容纳不止一个控件

`conversation.session.header.corner` 原本是 single 座位，而 `ui-sidebar-right` 早已把它的面板召回按钮放在那里。向 single 座位第二次注册会失败，而在线上组合里，这个失败把整个 notes 浏览器半边一起带走了：插件从未激活，应用壳连 frame 都没有渲染。现在这个座位是 list，每个占用者用 id 标出自己，因此一个会话标题栏的角落可以同时承载召回按钮与笔记控件。

### 收集一段文字需要一个覆盖会话的座位

已交付的会话座位里没有任何一个覆盖它的内容：`conversation.session` 只声明了 `conversation.view`。一个收集读者所选内容的气泡必须坐在那份内容之上，因此 `conversation.session` 多了一个子座位 `conversation.session.overlay`（`single`、session 作用域），在同一个元素内、View 之后渲染。它交给占用者两个事实——当前显示的 View 与承载它的元素——因为收集面既需要说明一段文字来自哪里，也需要判断某个选区是否属于这个会话。

第一个消费者是 `dsh-notes`，它的气泡按任何其它扩展的方式注册：`ctx.slots.inject('conversation.session.overlay', …)`。另一条路——在 slot 体系之外覆盖会话——会把浮动层的生命周期与授权放到拥有组合的机制之外。

收集到的段落记录 `sessionId`、View 与一条本地位标签，不记录任何消息身份：会话的 DOM 没有标记一段文字来自哪条消息，而补上这个标记要动到每一个消息渲染器，只为服务一个其"定位原文"入口暂缓的特性。因此气泡只出现在笔记词汇能命名的 View 上，并在部署还没有笔记会话时启动第一个。

### 截图保留引用而不是字节

`notes/materialAddImage` 把编码后的字节交给部署的附件存储，并且只存下存储返回的东西，因此素材记录保持很小、一张图片无论被多少条素材指向都只存一份，笔记域也永远不会变成第二个图片仓库。没有附件存储的部署会回报 `attachments-unavailable`，而不是悄悄什么都不存。

选图是面板自己的控件，而不是对会话的截取：浏览器把文件读成规范 base64，因为那正是附件存储在 wire 上接受的形态；格式不受支持或浏览器读不出来都会如实报告，不去打扰宿主。

素材记录下的是存储返回的整份引用——域记录的版本 2，版本 1 只存 id——因为点名一张图片的请求部分就是 `{ type: 'image', attachment }`：只有 id 说不清组装与归一化所需的 media type、字节长度与尺寸。因此 `src/compose.ts` 把截图组装成那个 image block；素材是通过某个动作收集时，该动作的模板作为 text block 排在它前面；文字素材仍然只是它一直以来的那一个 text block。`src/thread.ts` 也会保留截图提交的那一行：它不带文字，因此该行同时报告 `hasImage`，面板则把图片与它可能带有的文字一并标出。

带图片的提交在发出任何东西之前，会先向 LLM 服务询问该会话路由声明了什么：`Analysis` 读 `Agent.options`，解析该路由的模型元数据，并在路由声明只接受文字输入时回报 `image-unsupported`，于是面板请用户换一个模型，而不是让模型在本该是截图的位置读到一段占位文本。只有"明确声明的否定"才算拒绝——agent 的 options 没有点名路由、部署没有挂载 LLM 服务、元数据读不出来，这些都属于未知而非不支持，这类提交照常进入拥有该失败路径的请求侧。因此这里的图像准入规则，与那些已经在提示前就拒绝的入口读的是同一套规则。

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

宿主半边承载完整的 Remote 命名空间，浏览器半边也接上了它，因此面板可以在不持有任何自己的规则的前提下列出会话与素材、编辑草稿、提交、读回回答并追问。缺的是收集与呈现：轨迹里没有任何收集选区的面、归档区与拖拽重排没有界面，记录的附件引用字段也没有写入方，因此没有截图链路，也没有 `materialAddImage` 操作。

素材正文与每个模型回答都活在会话事件里，因此插件域保持很小，素材内容从不复制。这也意味着读取某条素材的回答需要会话日志，而作答需要一条活的 Session：进程重启过的会话会回报 `session-not-live`，直到它被重新打开，因为 `ctx.agents` 只持有活的 Agent。

发送被拒时会回滚已记录的消息 id 并把素材标记为 `failed`。没有这个回滚，`analyse` 会把素材读成"已提交"，它就永远无法重试。

排序操作排在一条会 settle 的队尾之后逐个执行，因此一串连续收集会按调用顺序写入素材，代价是它们被串行化；每个操作只做一次表写入，所以在面板规模下这个队列不构成吞吐问题。

取回已归档会话时，它回到自己的创建位置而不是列表顶部，因为 `NoteSessionRecord` 没有顺序值；素材则会置顶，靠的是 `create` 与 `restore` 都会铸在全部可见兄弟之前的显式 `order` 值。

## 测试

`packages/notes/notes/tests/` 以逐文件 100% 覆盖率覆盖两个半边：真实存储栈上的域、素材排序与归档、会话记录与活动指针、按配置的工作区与模型创建会话（含加入 preset roster 与记录失败时释放 agent）、线程归属与投影、正文组装、内存 provider 上的设置节（含写入的取消语义）、针对替身 agent 注册表的分析编排、每个 Remote 操作的成功与拒绝路径，以及浏览器半边的注册、命令、拒绝文案、列表与详情渲染、设置卡（对照脚本化的 Remote 面）。

`notes-composition.host.spec.ts` 是 `packages/AGENTS.md` 对产品可见插件要求的非单测组合测试：它通过真实 Loader 启动一个测试专属的 `cordis.yml`，断言裸 `notes` 行到达 active、该行对外提供的正是 schema 默认值，以及卸载该行会释放域名。它等待服务发布而不是等 `loader.await()`，因为行的 fiber 会在它 `apply` 挂载的服务完成异步初始化之前就 settle。它的 `agents` 行是一个兄弟 Loader 行而不是 root 级 provide，因此该 spec 走的是与线上组合相同的解析路径。

## 相关

- [notes 设计记录](../../../../docs/superpowers/specs/2026-09-11-dsh-notes-design.md) —— 可行性勘察结论、数据模型与四阶段改动清单。
- [Phase 0-1 实现计划](../../../../docs/superpowers/plans/2026-09-11-dsh-notes-host-core.md) —— 本阶段遵循的任务分解。
