# dsh-notes 设计文档:网页端笔记插件

日期:2026-09-11

状态:待评审(界面已定稿;数据模型与调用流程见正文,文末列出我替你定的默认值)

## 背景与目标

在 dsh 网页端提供一个笔记面板,把 dsh 里的内容收进来,交给配置好的模型分析。它不独立于 dsh,而是依附于 dsh、共用同一套服务内核:素材、会话、模型调用、附件、工作区全部复用现成能力。

收进来的东西有两类:在对话或轨迹里划选的文字,以及粘贴的截图。

面板分上下两部分:上面是导航栏,下面是内容;内容分左右——左边是收进来的素材列表,右边是模型对当前选中素材的回答与追问。

关键前提(勘察结论,均已读源码核实):

- dsh 是 all-plugin Cordis 架构,客户端插件表在运行时从 Loader 的行模块发现:解析包名、读 `package.json` 的 `dsh.client`、读 `exports["./client"]` 指向的产物并作为 bundle 服务出去(`packages/client/modules/src/index.ts` 的 `resolveMeta()` 与 `compose()`)。没有构建期白名单,所以本插件按树内包注册即可被服务。
- 右栏是 tab 化 docking 面,外部包通过 `ctx.sidebarRightTabs.register(...)` 注册类型、通过键位 `sidebar.right.pane.tab` 渲染内容,`ui-sidebar-documentpreview` 是同一公开路径的现成证明。右栏的呈现、折叠、浮动由 `ctx.sidebarRight` 与 `ctx.layout` 的公开面驱动。
- 全仓没有任何选区 UI:`window.getSelection()` 只出现在三处,且都是"避免误触"用途,没有 `selectionchange`、`contextmenu`、popover 或浮动工具条。
- 聊天区每个节点渲染 `data-chat-anchor-key`、`data-chat-flow-key`、`data-chat-flow-kind`、`data-chat-turn`,工具行另有 `data-chat-call-id`;`ui-tool/README.md` 把它们明确称作用于分页与选择的 DOM 契约。从选区用 `closest('[data-chat-anchor-key]')` 可以拿到节点 key,再经 `useChat` 快照得到 `anchorSeq`。
- 图片端到端可用:`PromptContentPart` 接受 `{ type: 'image', mediaType, data }`,附件面 `ctx.attachments` 负责归一化、校验、落盘;默认模型 `deepseek-flash` 自带 image 模态,且真实 API 的 e2e 已覆盖。
- 仓库硬规矩 **Model-visible ⟺ logged**:凡进入模型请求的内容必须能从会话日志重建。

不在本版目标内:跨设备同步、导出导入、全文搜索、素材互引。

## 已确认的决策

| 决策点 | 结论 |
|---|---|
| 交付形态 | 树内包,进本仓库跟随构建 |
| 左列表粒度 | 一行 = 一个收集的素材(标题 + 内容预览),不是会话、不是问答线程 |
| 素材存放 | 先存插件自己的存储,"分析"时才变成会话里的一条消息 |
| 多素材语义 | 各答各的:一行对一段输出,连收多段也是多轮,不合并 |
| 新建会话 | 全新一本笔记,旧的连同素材与对话一起归档,可从导航栏切回 |
| 笔记会话本质 | 真实 dsh session,绑定工作区、模型、权限 |
| 模型问答路径 | 走 session,不走旁路 `ctx.llm.stream` |
| 划词浮层动作 | `＋ 添加到笔记`、`翻译`,外加 `⋯` 作为可扩展位 |
| 动作语义 | 动作 = 提示词模板 + 是否自动发送;`翻译` 永远自动发送 |
| 可编辑性 | 跟策略走:仅添加时素材正文可编辑;立刻分析时进会话后不可编辑 |
| 素材归档 | 行悬停出归档按钮,进列表底部「已归档」区,取出后置顶 |
| 素材排序 | 可拖拽手工排序 |
| 会话归档 | 保留;会话胶囊悬停出归档按钮,进「历史」,可切回;最后一个会话不可归档 |
| 面板呈现 | 只有两态:浮窗与停靠(全屏已砍掉) |
| 会话可见性 | 接受与编码会话混杂在左侧列表;用「笔记 · 」命名前缀 + 专用工作区区分 |
| 定位原文 | **暂缓跳转,本版做纯展示。** 来源条与「定位原文 ↗」入口照定稿界面保留,点击给出说明性提示;跳转能力后续单独完善,届时界面无需大改 |

## 总体架构

```
浏览器(面板 UI)
  ├─ 右栏 tab 类型 + sidebar.right.pane.tab 渲染内容
  ├─ shell.overlay 划词浮层
  └─ 列表 / 详情自渲染(不复用 Chat 视图)
        │  插件自有 RPC
        ▼
宿主半边(同包)
  ├─ ctx.storageDomain   素材与笔记会话的持久化
  ├─ ctx.settings        策略、动作模板、默认工作区
  ├─ ctx.attachments     截图落盘,得到 ImageAttachmentRef
  └─ ctx.agents          对笔记会话 followup 一条 user message
        │
        ▼
dsh 会话内核(session log / agent loop / 模型路由)
```

**为什么必须有宿主半边**:截图的字节量放不进浏览器 localStorage;素材需要持久化;策略与动作模板不能被浏览器侧 Config 承载(客户端 `DshClientManifest` 没有 config 字段,boot 时是 `loader.create({ name })`,cordis 行的 `config` 只到宿主半边)。

**为什么走 session 而不是旁路调用**:`docs/architecture.md` 的 Model-visible ⟺ logged 由运行时不变式断言。旁路直调 `ctx.llm.stream` 需要新增 `SessionEventMap` 事件才合规,并且还需要自建一条宿主 RPC 把浏览器字节变成 `ImageAttachmentRef`、自写流式转发与渲染。走 session 则截图链路、流式输出、模型与权限选择、日志合规全部现成。

## 数据模型

会话日志是内容真相,插件存储是归属索引。素材正文与模型输出都不复制进插件存储,只存锚点。

### 笔记会话

```
NoteSession {
  id          NoteSessionId       插件自有 id
  sessionId   SessionId           dsh 会话 id
  title       string              显示名,默认「笔记 · <工作区名> <序号>」
  createdAt   number
  archivedAt  number | null
}
```

### 素材

```
Material {
  id          MaterialId
  noteId      NoteSessionId
  kind        'text' | 'image'
  text        string | null       文字素材正文,可被用户编辑
  image       ImageAttachmentRef | null   截图,收集时即落盘
  source      MaterialSource
  action      ActionId | null     null = 添加到笔记
  order       number              手工排序位
  status      'draft' | 'analyzing' | 'analyzed' | 'failed'
  anchors     SessionSeq[]        该素材产生的每条 user/message 的 seq(含首次分析与后续追问)
  error       string | null
  createdAt   number
  archivedAt  number | null
}
```

`status` 的含义:`draft` 是仅添加策略下等待编辑与分析的常态;`analyzing` 是已提交、模型尚未收束;`analyzed` 是已拿到回答,可继续追问;`failed` 保留失败原因,可重试。

### 来源

```
MaterialSource {
  sessionId  SessionId            来源会话(不是笔记会话)
  view       'chat' | 'trajectory'
  seq        SessionSeq | null    来源事件序号
  messageId  MessageId | null
  callId     string | null        工具调用 id,有则可跳转
  label      string               显示用,如「会话《可行性分析》第 3 轮」
}
```

这四个字段是可持久化的来源标识;其中 `SessionId`、`seq`、`MessageId`、`callId` 都能从被选中的 DOM 锚点推导出来。

### 线程归属规则

这是本设计里唯一需要精确表述的规则。

一条素材在会话里可能产生多段对话:首次分析一段,之后每次追问又一段,而且追问不保证与首次分析相邻(用户可以先分析素材 B,再回到素材 A 追问)。

因此不用"连续区间"划分线程,而是**显式记录归属**:每条由素材产生的 user message,其 seq 被追加进该素材的 `anchors`。渲染某素材的线程时,按 seq 升序取会话事件,遇到属于该素材的 user message 就纳入,并纳入它之后、下一条 user message 之前的全部事件。

这样归属是精确的,不依赖消息在日志里是否相邻;模型输出与工具调用不需要复制到插件存储,永远从日志读。

### 持久化

在 `ctx.storageDomain` 开一个 domain 保存 `NoteSession[]` 与 `Material[]`。截图字节不进 domain,只存 `ImageAttachmentRef`。

已知行为:附件一经落盘永不自动回收,所以用户在 draft 状态删除的素材会留下孤儿附件。本版不做垃圾回收,与附件面既有语义一致。

## 核心流程

四条流程:收集文字、收集截图、分析、追问,外加归档与排序的两条写操作。所有写操作都由浏览器发起、宿主执行,浏览器不直接持有素材真相。

### 收集文字

1. 用户在对话或轨迹里划选文字,`shell.overlay` 上的浮层出现。
2. 解析来源:从选区的 `startContainer` 向上 `closest('[data-chat-anchor-key]')` 取节点 key,经 `useChat` 快照映射到 `anchorSeq`;轨迹视图走 `data-trajectory-row-key`。取不到锚点时降级为"仅记录会话,不记录位置",不阻断收集。
3. 点 `＋ 添加到笔记`:浏览器调用插件 RPC 落一条 `Material`,状态取决于策略——`manual` 落 `draft`, `auto` 落 `draft` 后立即分析。
4. 点 `翻译`:落一条 `action = translate` 的素材,并**无条件**立即分析(点它的目的就是翻译,不受策略影响)。

### 收集截图

1. 面板的输入区或素材区捕获 paste 事件,取出 `kind === 'file'` 的项。
2. 浏览器把字节交给插件 RPC,宿主调用 `ctx.attachments.saveImage({ data, mediaType })` 得到 `ImageAttachmentRef`。
3. 落一条 `kind = 'image'` 的素材。截图在收集时即上传,理由是素材需要稳定引用,且宿主构造消息时需要一个可用的 ref。

### 分析

宿主侧按以下步骤把素材变成一次模型请求:

1. 组装 content:截图素材是 `[{ type: 'image', attachment: ref }]`;文字素材是 `[{ type: 'text', text }]`;动作类素材把动作模板前置,即 `text = promptTemplate + '\n' + material.text`。
2. `createUserMessage({ content, source: { kind: 'plugin', plugin: 'notes' } })`。
3. `agent.followup(message)`,并把返回的 seq 追加进该素材的 `anchors`,状态置 `analyzing`。
4. 模型收束后状态置 `analyzed`;失败置 `failed` 并保留原因。

**关于"仅添加"的机制更正**:早前讨论中曾把 `agent.inject()` 当作"仅添加"的实现。它不适用——`inject()` 的语义是内容停在 inbox,等下一个消息被 admitted 时**合并进同一次请求**,这与"各答各的"直接冲突。正确做法是素材根本不进 inbox,先落在插件存储里,点「分析」时才 `followup()`。两种策略因此是同一个入口,差别只在触发时机。

### 追问

在素材详情底部输入并发送,宿主对笔记会话再 `followup()` 一条 user message,其 seq 追加进当前素材的 `anchors`。

一个笔记会话同一时刻只跑一个 turn;连续提交的分析请求会按序排进后续 step,每条消息各占一个 step,因此仍然各答各的。

### 归档与排序

- 素材归档:写 `archivedAt`;取出时清空并把 `order` 置于最前。
- 素材排序:拖拽写回 `order`。
- 会话归档:写 `archivedAt`,并从当前活动会话切走;最后一个未归档会话不允许归档。

## 界面设计

界面已定稿,可交互原型在仓库外:`C:\Users\HUAWEI\.dsh\brainstorm\notes-ui\content\notes-panel-v9.html`;同一目录下的 `DESIGN.md` 记录了完整的可行性证据与演进过程。

### 两种呈现

| | 浮窗 | 停靠 |
|---|---|---|
| 位置 | 浮在对话之上,标题栏可拖 | 贴右列,对话让出宽度 |
| 尺寸 | 八向可缩放(四角 + 四边) | 拖左边缘改宽 |
| 装饰 | 圆角、阴影、边框 | 无圆角、无阴影,仅左侧分隔线 |
| 默认 | 720 × 500 | `min(620, 窗口宽 − 360)`,保证两栏可见 |
| 切换 | 标题栏按钮切到停靠 | 标题栏按钮浮出为窗口 |

切换带约 200ms 过渡;拖动与缩放期间不加过渡。两个形态共用同一份内容树,切换不重挂载。

### 导航栏

```
[←] [笔记 · 插件设计讨论 ▼]   …   [仅添加|立刻分析]   ＋ 新建   历史   ⚙   呈现切换   ✕
```

`←` 只在单栏且处于详情时出现。会话胶囊悬停时右侧出现归档按钮;点击胶囊弹出会话列表,含「已归档」区与「切回」。按钮顺序固定为设置、呈现切换、关闭。

关闭是收起而非销毁;收起后从对话标题栏的角落位置召回——对应真实的 `conversation.session.header.corner` 座位。

### 响应式阈值

两个阈值分工不同,刻意分开,避免"面板一窄就把文字按钮删了"的观感:

| 阈值 | 管什么 |
|---|---|
| 560px | 布局:低于它,列表与详情变成互斥的单栏,详情左上出现返回 |
| 500px | 导航栏:低于它,文字按钮才收成图标 |

### 左列表

每行是状态点、标题、两行预览、来源标签与状态文字。状态点为灰(待编辑)、蓝闪(分析中)、绿(已分析)。来源标签区分对话、轨迹、截图;动作类素材带动作标签。悬停时左侧出现拖拽手柄、右侧出现归档按钮;拖拽时用插入线提示落点。列表底部是折叠的「已归档」区,带条数角标,展开后条目弱化显示并可取出置顶。

### 右详情

自上而下:来源条(来源文字 + 定位原文)、动作类素材的打包内容回显、素材正文、可编辑时的操作行(分析 / 复制 / 归档 / 删除)与提示、模型回答与追问、底部追问输入框。

素材正文在 `draft` 时是可编辑框,在已进会话时是只读灰底。这条对应"仅添加时微调笔记内容,立刻分析时不需要编辑"。

### 划词浮层

选中文字后在上方浮出深色气泡,尾巴指向选区,内含 `＋ 添加到笔记`、`翻译`,以及 `⋯` 扩展位。

## 接口设计

面板与宿主之间只有两样东西:一组自有 RPC 操作,和一个设置命名空间。前者读写素材与会话,后者承载全部随部署变化的选项——浏览器半边拿不到 cordis 行的 config,所以策略与动作模板必须住在宿主侧。

### 宿主 RPC

插件自有命名空间,树内可加进 `api/remotes` 的客户端装配清单并获得生成的强类型客户端。需要的操作:

- 会话:`notes/sessionList`、`notes/sessionCreate`、`notes/sessionSelect`、`notes/sessionArchive`
- 素材:`notes/materialList`、`notes/materialAddText`、`notes/materialAddImage`、`notes/materialUpdate`、`notes/materialAnalyze`、`notes/materialAsk`、`notes/materialArchive`、`notes/materialRestore`、`notes/materialReorder`、`notes/materialRemove`
- 订阅:一条 `mode: 'stream'` 的会话更新流,推送素材状态与线程变化

### 设置

宿主 `ctx.settings` 下的一个命名空间,浏览器经 RPC 读取:

```
modelStrategy       'manual' | 'auto'          默认 manual
actions             ActionDef[]                默认内置翻译
defaultWorkspace    string                     首次启用时选定
defaultModel        { provider, model } | null 可选;为空则沿用会话默认
```

```
ActionDef {
  id             ActionId
  label          string          浮层与标签上显示的文字
  promptTemplate string          前置到素材正文的提示词
  autoSend       boolean         点击后是否立即分析
  enabled        boolean
}
```

内置翻译动作的模板为「不改变语句结构,翻译下列内容:」,`autoSend` 为真。目标语言默认由模型自行判断中英方向,后续可在模板里显式指定。模板必须可配置——仓库规则不允许插件硬编码随部署变化的选项。

### 首次启用与工作区

第一次打开面板时引导选择一个工作区,可同时选定模型;写入设置后不再询问。新建笔记会话时沿用该工作区与模型,并可在会话菜单里更改。权限沿用 dsh 会话默认,插件不引入独立权限模型。

## 改动清单(按 Phase)

分四个阶段推进,每阶段结束都应是一个可运行、可验收的状态。Phase 0 到 1 之后插件在宿主侧已经完整,只是没有界面;Phase 2 之后核心交互闭环;Phase 3 与 4 补齐划词入口与配置能力。

### Phase 0 — 包骨架与注册

- 新建包 `packages/notes/notes`,包名 `@deepseek-ai/dsh-notes`,**一个包同时具备宿主半边与浏览器半边**,由 `package.json` 的 `dsh.client` 声明标出浏览器半边。先例是 `packages/session-query/session-log-export`(宿主 `src/index.ts` 156 行 + `src/client/`)。
- **不能放在 `packages/client/` 下。** 该目录的新包清单写明 `src/index.ts` 是 empty node-half apply(`packages/client/AGENTS.md`),而本插件的宿主半边很重(存储域、设置、会话编排、Remote),放进去会与该目录的约定直接冲突。
- 三处注册缺一不可:`tsconfig.client.json` 的 aggregate `references`、`packages/bundle/web-app/cordis.patch.yml` 的 `dsh.client` 行、`packages/bundle/web-app/package.json` 的依赖。
- `package.json` 声明 `dsh.client`(`platform: 'web'`)与 `exports` 的 `.`、`./client`、`./package.json`、`./src/*`(以及 Remote 生成物对应的条目),`tsdown` 用现有 `clientBundle()` 预设,浏览器半边保持 lazy-CJS 输出。

### Phase 1 — 宿主半边

- storage domain 的 schema 与读写(`NoteSession`、`Material`)。
- settings 命名空间与 `installSection()`。
- 自有 RPC 命名空间与装配清单登记。
- 会话创建:按设置里的工作区与模型建 dsh 会话,并把 `NoteSession` 落库。
- 素材分析与追问:组装 content、`followup()`、回写 `anchors` 与状态。
- 截图落盘:接收字节并调用 `ctx.attachments.saveImage()`。

### Phase 2 — 面板 UI

- 注册 `sidebarRightTabs` 类型与 `sidebar.right.pane.tab` 渲染体,以及标题座位。
- 两种呈现的切换与尺寸状态;停靠态改变对话列宽。
- 左列表:行渲染、状态点、悬停归档、拖拽排序、「已归档」区与取出置顶。
- 右详情:来源条、素材正文(可编辑 / 只读两态)、自渲染的模型回答与追问、追问输入框。
- 响应式的两个阈值。

### Phase 3 — 划词浮层与来源

- 在 `shell.overlay` 上注册浮层,用 `window.getSelection()` 与 `mouseup` 驱动,按选区矩形定位。
- 来源解析:DOM 锚点到 `SessionId`、`seq`、`MessageId`、`callId` 的映射;取不到锚点时降级。
- 定位原文:本版**只做展示**。来源条与「定位原文 ↗」入口按定稿界面照常渲染,点击时给出说明性提示(跳转能力尚未提供);本版不做任何跨包改动。
- **来源解析仍要照常做实。** 即使不跳转,`SessionId`、`seq`、`MessageId`、`callId` 都必须正确落到素材上——否则日后补跳转时要回头重做数据,那才是真正的返工。
- 暂缓的原因:`openView` 只作为会话 slot 的 props 暴露(`conversation.view` 的 owner props 与 `ConversationSessionInjected`),而 `ctx.conversation`(`IConversation`)的公开面只有 `input`、`blocks`、`send`、`updateQueue`、`cancel`、`loadOlder`,没有视图导航。右栏面板不在会话 slot 树内,够不到 `openView`,因此从右栏发起跳转要先给产品包补一个转发。
- 后续完善时要做的事(不阻塞本版):给 `IConversation` 加一个会话寻址的 `openView(sessionId, view, focus)`,实现直接复用 `apply.ts` 里已有的 `activateView(sessionId, view)` 与该会话 store 的 `actions.openView`——两者都在同一个 apply 闭包内,是一个方法与一处转发的量。界面入口已经预留,届时只需接上。
- 截图粘贴通路。

### Phase 4 — 动作与设置界面

- 动作注册表与内置翻译动作;模板组装与自动发送。
- 设置卡:策略、动作模板、默认工作区与模型。

## 错误处理与边界

- **插件激活失败会拖垮整个 Web UI**。`packages/client/web/README.md` 写明部分可用不受支持:任一 entry 导入失败或卡在缺失服务上,整个应用停在 boot 页。因此激活路径上只做注册,任何取数据、建会话、解析来源的重活都延后到用户真正打开面板或触发动作时再做,并且每一步都要能被捕获。
- 模型不支持图像:宿主返回稳定的失败原因,面板提示用户更换模型,而不是静默丢弃截图。
- 截图超出附件限制(单图、像素、尺寸)时透传附件面的错误码并本地化提示。
- 选区跨多个节点:取最近的锚点;完全取不到时不阻断收集,只降级来源显示。
- 追问与分析的并发:同一会话同时只跑一个 turn,后续请求排队到后续 step,不合并。
- **不直接 import `ui-dockkit`**。其 README 写明导出可能在任何版本变化;只使用 `ctx.sidebarRight` 的公开面。
- 浏览器半边、Cordis、React 与基线 UI 库都是 shell 注入的共享模块,插件不得自带副本;插件与 dsh 版本绑定。

## 测试

- 单元:来源解析(含取不到锚点的降级)、动作模板组装、存储读写与线程归属计算。
- GUI 套件:`pnpm run test:gui`,客户端与宿主侧 GUI 包。
- 组装后可见输出变化时补 `DSH_SNAPSHOT=replay pnpm run test:web`。
- 非平凡的模型或用户可见变更需要 keyless recorded-session 快照;若快照机制不支持面板场景,在同一变更里补齐支持。
- 覆盖率:客户端源包在 per-file 100% 门内。
- 真实组合测试:产品可见插件需要 Boot 真实 `cordis.yml` 的非单测组合测试,断言用户可见输出。

## 仓库规则遵循

- 非平凡变更必须带 Agent Note 且同 PR 提交。
- 所有产品文案走类型化 locale 字典,`verify-client-ui-i18n` 会拒绝硬编码字符串。
- slot 纪律:只用 `ctx.slots.register()` 组合 UI;不声明别人的 slot,不渲染未声明的 slot;不 import 其他 feature 插件的运行值。
- 文档门禁:`verify-md-wrap`(一段一行)、`verify-md-links`、`verify-doc-budgets`。
- 本 spec 所在目录 `docs/superpowers/` 已在 `scripts/translation-pairing.manifest.json` 的排除清单中,不需要也不允许生成 `.zh.md` 或 `.i18n.yaml` 配对文件。
- 推送前检查走 `dsh-pre-push-checks`。

## 明确不做(YAGNI)

- 跨设备或跨浏览器同步笔记。
- 笔记导出、导入、全文搜索。
- 素材之间的互相引用与双向链接。
- 自建"揭示某条消息 / 某个 seq"的公开 API。
- 在会话列表里隐藏笔记会话。
- 树外分发与第三方安装支持。
- 孤儿附件的垃圾回收。
- 素材标题的模型摘要生成,首版用正文截断。

## 我替你定的默认值

以下几处是按已有决策或仓库规则推导出来的,评审时请重点确认:

| # | 我定的 | 理由 | 若不同意会怎样 |
|---|---|---|---|
| 1 | 线程归属用"显式记录每条 user message 的 seq"而非连续区间 | 追问可能不与首次分析相邻,区间划分会错 | 改用区间划分会让线程渲染在追问场景下归属错误 |
| 2 | 两种策略都走 `followup()`,不使用 `inject()` | `inject()` 会把多条素材合并进同一次请求,与"各答各的"冲突 | 若改成 inject,左列表就无法一行对一段输出 |
| 3 | 截图在收集时即上传 | 素材需要稳定引用,宿主构造消息需要 ref | 改成分析时上传,素材需要多一个待上传状态,且 draft 期间字节无处安放 |
| 4 | 首版素材标题用正文截断 | 零成本;模型摘要要额外一次调用 | 加模型摘要会引入一次辅助调用与相应延迟 |
| 5 | 翻译目标语言默认由模型判断 | 避免首版就引入语言配置 | 可改为设置项显式指定 |
| 6 | 锚点取不到时降级而不阻断收集 | 划词本身是高频动作,失败即丢弃体验差 | 改成拒绝收集会让来源更纯,但容易丢内容 |
| 7 | 包名 `@deepseek-ai/dsh-notes`,路径 `packages/notes/notes`,单包双半边 | `packages/client/AGENTS.md` 规定 `packages/client/*` 的宿主半边必须为空,而本插件宿主半边很重;双半边先例是 `session-log-export` | 若改成拆两个包(宿主包 + `packages/client/ui-notes`),就与 `feedback/message-feedback` + `client/ui-message-feedback` 的先例一致,但会多出一条跨包依赖与 Remote 消费接线 |
