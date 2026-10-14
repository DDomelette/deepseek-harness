# Agent Note: 上游 0.2.1-alpha.2 合并的集成决策

Status: implemented

[English](2026-10-12-upstream-merge-integration.md) | 中文

## Problem

本 fork 将上游 0.2.1-alpha.2（`upstream/master` `d743267388`）合并进一棵已在会话族、shell、subagent 平面、settings 平面与 job 镜像上大幅分叉的树。上游替换了 fork 若干特性赖以建立的接缝——jobs 通知 API、settings provider 接缝、`SubagentRuntime` 的续接入口、消息来源词汇、会话日志格式——同时还带来了本 fork 没有消费方的若干表面。每条接缝都要做出选择：把 fork 的行为移植到新 API 上、接受上游的替代并删除 fork 的版本，或将上游的表面搁置。采用上游的 `SESSION_FORMAT_VERSION = 4`、却让 JSONL 扫描器继续以 V3 规则接纳当前世代的物理行，导致每个含 system 消息的会话日志都不可读；这一缺陷最先以 Agent Team 包中九个冷恢复失败的形式暴露。

## Decision

把 fork 的行为移植到合并后的 API 上，在 fork 的代码就是存续实现的包内保留 fork 独有实现，并搁置本树无人挂载的上游表面。以下各节记录塑造了已交付行为的四处移植、settings 与会话格式的迁移，以及刻意未采纳的内容。

## Loader 采用上游版本，fail-loud 移至启动审计

上游的 `packages/boot/**` 被逐字采纳，而它审计的是一棵已定型的树：`mountRootInclude()` 返回后，`inactiveEntries()` 遍历 `ctx.loader.entries()`，`auditStartupEntries()` 再把未激活的必需行变成 `StartupError`。fork 的 vendored `vendor/{loader,include}` 却把配置重载做成了事务式——`EntryGroup.update()` 抛出第一个子项失败——于是启动永远到不了审计，每一行的失败都表现为 `plugin tree failed to load: failed to apply loader entry include (cordis:include): …`，而不是 `startup failed: 1 required plugin did not activate`。仅这一处不匹配就让三十七条启动用例失败。现在 vendored loader 承载上游的生命周期：`entry.ts`、`group.ts`、`tree.ts` 都是上游的，`group.ts` 捕获每个子项 `create()` 的失败并记录日志，导入失败的行保留在树上但没有 fiber。「配置错误在加载时响亮失败」是被移位而非丢弃：Loader 指出它无法启动的那一行，而拒绝启动的是启动审计。两半都由 `packages/boot/app-boot/tests/app-boot.spec.ts` 钉住。

fork 保留上游不提供的 vendor 增量，逐条记录在 `vendor/README.md`：可持久化的去抖 include 写入、按 Include 串行化的写入队列——现在在根停止之前排空，因此被拒的写入仍会让拆卸以拒绝结束——惰性的 `internal/config` 解析、`disabled` 插值、`moduleNamespace`，以及易变配置分支。两个钉住事务式 loader 的 fork host spec 改为按审计行为表述，而不是删除：`packages/host/webserver/tests/webserver.spec.ts` 让 webserver fiber 结算为失败并断言它的 `fiber.await()` 以 `EADDRINUSE` 拒绝；`packages/host/directory-picker-auto/tests/loader-composition.spec.ts` 断言失败的 surface 行不持有 fiber，而它的兄弟行仍保持挂载，且导入失败会到达 loader 的错误通道。

## Job 变更改走合并后的 jobs 事件流

fork 的 `SessionControlController` 按会话镜像后台 job，`ui-jobs` 在该镜像之上渲染其头部，因此按上游的做法删除接线等于删掉一个已交付特性。合并后的 jobs 服务用经过过滤的事件流取代了 `onJobsChanged(owner)`，于是 `packages/api/session-controller/src/control.ts` 以 `events.subscribe({ owners: 'all' }, …)` 订阅，忽略不改变任何已发布行的 `output` 与 `progress` 事件，并在对应旧通知点的生命周期提交上重新发布。job 查询传入 `SessionId`（`jobs.list(caller)`）而非 `Agent`，与合并后的注册表一致：无属主的 job 对每个调用方可见，有属主的 job 对该会话可见。

## subprocess 控制通道是一次增量移植

fork 的可靠性工作需要一条与 stdio 并列的字节通道。`packages/subprocess/subprocess/src/control.ts` 拥有该协议：描述符 `SUBPROCESS_CONTROL_FD` 为 7、私有启动标记 `DSH_SUBPROCESS_CONTROL`，以及 `openInheritedControlChannel()`——它消费该标记并在继承来的描述符上返回字节模式双工 socket。`SubprocessStdio` 新增可选的 `control?: 'pipe'` 请求，`SubprocessHandle` 新增可选的 `control` 双工流，因此未请求该通道的启动器不受影响。Windows 启动路径通过 `packages/subprocess/win32-process/src/control-stdio.ts` 承载同一条通道，`sandbox-windows-acl` 则把既有的 fd 7 转发给受限子进程，并在使用管道 stdio 时拒绝 control。

同一区域的三处上游内容已恢复。`disposeManagedProcesses` 重新在清空集合之前等待每个控制端点的 `close`（上游 `562e7f364e`），这正是 `channel.closed` 在 dispose 返回后为真的原因；注册点本就会移除已关闭的端点，因此它等待的每一项都仍会被 `destroy()` 关闭。`win32-process` 重新隐藏初始控制台——`abi.ts` 中的 `STARTF_USESHOWWINDOW` 与 `SW_HIDE`、`STARTUPINFOW` 编码器中的 `wShowWindow`，以及 `spawnPipedProcess` 与 `spawnJobProcess` 两处标志位——并且 `launchWindowsJob` 传入 `windowsHide: true`，那里的注释因此拒绝 `CREATE_NO_WINDOW`：受限令牌在没有控制台时可能 DLL 初始化失败。`sandbox-windows-acl/tests/control.spec.ts` 是上游的文件，它启动的 `win32-process/tests/fixtures/console-state.ts` 已按字节一致恢复。

**控制描述符在 Windows 上必须是重叠管道。** 合并把 `runnerStdio` 中两处 `'overlapped'` 换成了 `'pipe'`。同步管道在 Windows 上无法承载 `net.Socket` 端点：子进程的首次写入及其回调都会被推迟到对端读取之后，于是先打招呼再读取的子进程永远送不出问候，而卡在 `c.write(…)` 里的子进程永远到不了 `c.destroy()`。恢复 `'overlapped'`——也就是上游自己的 `ptc-runtime-node/tests/process.spec.ts` 为描述符 7 传入的值——使 `ptc-runtime-node/tests/runtime.spec.ts` 从二十条超时变为 26 passed | 1 skipped，并让两个生命周期用例留在 `subprocess-local/tests/control.spec.ts` 中，而不必移入被排除的文件。

## 会话删除经 workspace 注册表执行遗忘

`packages/workspace/workspace` 暴露 `registry.forgetSession(sessionId)`，因此 `session-deletion` 在删除计划的 workspace 环节调用它，并把该成员推进到 `done`。消费方不为「注册表缺少该方法」携带任何补偿：当 `workspaceRegistry` 缺失时，该成员被标记为 `skipped`，由持久化计划记录这一结果。

## subagent 的 working directory 注入

合并后的 `SubagentRuntime` 通过 `ctx.workingDirectory.ensure(parent, signal)` 解析每个子会话的目录，因此该服务属于它的注入集合。挂载了 subagent runtime 却没有 `dsh-working-directory` 的组合会让每次启动与每次冷恢复停在挂起状态，而不是显式失败：基础 bundle 挂载了它，测试则挂载共享的 `mountWorkingDirectoryFixture`。

## 工作流执行采用上游的 PTC runtime

fork 交付的是 `packages/workflow/workflow-worker-thread`，一个 `node:worker_threads` 引擎。上游已退役该执行基座：[工作流沙箱复用](2026-09-13-workflow-ptc-sandbox-reuse.zh.md)在共享 Node `PtcRuntime` 之上于 `packages/workflow/workflow-ptc` 中实现 `WorkflowEngine`，并拒绝第二个启动器，因为终止 worker 既无法施加会话的文件策略，也无法提供直接执行 Node 代码本就需要的受管进程清理。本次合并两边都没有整体采纳：`apps/cli/package.json`、`tsconfig.host.json`、`scripts/gen-doc-graphs.ts` 与 `packages/experimental/ralph-bundle/cordis.patch.yml` 属于上游、写的是 `workflow-ptc`，而 `packages/bundle/base/cordis.patch.yml`、web-app 的 `standard`、`ptc`、`cordis` 三个 preset 以及两个模型侧消费方属于 fork、写的是 `workflow-worker-thread`，于是两个引擎都被导入、只有 fork 的被挂载。

现在引擎是上游的。基础 bundle 在 `@deepseek-ai/dsh-workflow-ptc` 旁挂载 `@deepseek-ai/dsh-ptc-runtime-node`；web-app bundle 禁用该宿主行，改由各 preset 在已经隔离 `workflowEngine` 的 realm 内挂载该引擎；`tool-workflow` 与 `tool-ralph` 通过 `packages/workflow/workflow-ptc/tests/setup.ts` 的 `mountWorkflowRuntime` 组合各自真实引擎的用例。fork 的包连同全部入口一并退役：`./worker` 导出及其路径别名、tsconfig 项目引用、CI 原生通道与 `processBoundTests` 行、source-workflow 与 built-worker 门禁条目、清单依赖，以及 group、subsystem 与组合参考的行。

`packages/workflow/workflow-worker-thread/tests/integration.spec.ts` 在 `workflow/agent-start` 上断言 `ctx.agents.get(agent.childId)`。那不是合并后生命周期的发布信号：`ctx.subagents.startActivation({ delivery: 'caller' })` 在接纳时即兑现，而子 agent 之后才会在 agents 注册表中可读。上游替换后的 spec 断言引擎真正拥有的发布——先观察到 `subagent/start` 事件，再看到工作流自己的 `agent-start`——两个引擎都无需改动即可满足，因为二者都只在 `startChild` 兑现之后才发出 `agent-start`。

## settings 命名空间来自组合

上游替换了 settings provider 接缝：`SettingsForms` 依据每个活跃 Loader 条目导出的 `Config` schema 为其派生一个命名空间，于是插件声明自己的 section，而不再调用 `ctx.settings.register()`。本 fork 选择迁移消费方而非恢复该接缝——`settings-controller` 引入 `SettingsForms`、用呈现映射填充 `autoGenerate`，并在 `RemoteErrorDetailsMap` 中声明 `agent-preset/read-only`；`mcp-manager` 声明一个 volatile 的 `Config` 字典，并把其声明式交叉校验移入受活跃 fiber 约束的内部 `config` waterfall 监听器，从而保留 fork 的写入拒绝与已存 section 兜底。

## 会话格式 v4 接纳

合并不但采用了 `SESSION_FORMAT_VERSION = 4`，还引入了 `packages/session/session-format-v3-to-v4`；但合并原样保留的 fork 版 `packages/session/session-persistence-jsonl/src/format.ts` 仍在用 `assertV3RowAdmission` 接纳当前世代的物理行，且从不运行 `assertReleasedV4Relationships`。V3 接纳要求 `system/message` 的来源为 `kind: 'plugin'`，而合并后的 `createSystemMessage` 写入的是 `kind: 'system-prompt'`，于是扫描器拒绝循环写出的每一个日志，所有回读路径随之失败。本次移植把上游的三行重新落到 fork 的扫描器上：导入块中的 `KNOWN_SESSION_EVENT_TYPES`、`consumeEventLine` 中的 `assertV4RowAdmission(decoded, KNOWN_SESSION_EVENT_TYPES)`、`finish()` 中的 `assertReleasedV4Relationships(artifact, KNOWN_SESSION_EVENT_TYPES)`，以及指向 `dsh-session-format-v3-to-v4` 的依赖、项目引用与聚合引用。

## 归档时刻在生产方恢复

上游注册表从不携带归档时刻——`git log -S archivedSessionAts upstream/master` 为空，其 `archivedSessionIds` 只有归档顺序。合并从上游取了 `packages/workspace/workspace/src/{index,spec}.ts`，却保留了 fork 的 `workspace-controller` 线格式与 Client 层，于是 `packages/api` 下 49 处读取点与 `ui-settings-archived` 读取一张没有生产方写入的映射；该包自身 host 规格中的两个失败用例即为症状。本次在上游注册表上增量恢复 fork 的生产方：`workspaceDomainState.archivedSessionAts`（`z.record(sessionId, z.string()).default({})`），由 `archiveSession` 在同一次清除置顶的持久写入中打戳，并由 `unarchiveSession` 与 `forgetSession` 删除。上游的归档动词、归档准入事件与置顶集合均未改动，领域版本仍为 2，因为该字段对旧介质有默认值。

## gateway 跟随上游，调用方权限保留 fork 的模型

上游把 Remote 流协议在 `packages/api/gateway` 与 `packages/api/remotes` 中一起重做，同时把 `dsh-client-connection` 的调用方模型替换为「每个被接纳的请求都代表同一个 operator Peer」。合并当时取了这一对的测试，却把它的源码留在合并基线上，于是两个平面在 RPC 上一致、在会话与流状态上不一致：客户端能启动，Host 创建并持久化了实时会话，而输入框始终不解锁。现在这一对取自上游，并把其中十处 fork 独有改动重新落回——四个额外的 Remote 挂载（`sessionPins`、`mcpServers`、`mob`、`notes`）及其所需的三个转发事件（`skills/change`、`mcp-servers/change`、`notes/material-settled`）、它们的 manifest 依赖与工程引用、凭据假实现新增的 `readRecord`、权限桩所需的 `socket` 与 `setHeader` 成员，以及 `authorizeIndex(...) === 'serve'`。

调用方模型仍属 fork。Connection 保留配对设备权限：设备 cookie 的权限低于回环启动令牌——`isLocalOperatorRequest` 正是移动端路由使用的判据——因此 `HostConnectionHandle.admit(request)` 返回调用方自身类别的 Peer：启动令牌凭据得到 operator Peer，设备 cookie 得到该设备自己的 Peer。上游的 `admit` 会把 operator Peer 交给每一个被接纳的请求；照搬就会把配对设备提升为 operator，因此 `ConnectionPeer`（`packages/client/connection/src/peer.ts`）是唯一实现——一个由 Connection 拥有的 scope，operator 铸造一次，每台设备各铸造一次。RPC 拦截器的第四个参数就是发起该请求的调用方 Peer，它在 TCP 对端仍可观测之处解析，因此按 scope 的分发与流复用器的 Peer 生命周期绑定都不会覆盖凭据未授予的类别。吊销设备会释放它的 Peer，这正是终止该设备已持有流的机制。

**客户端半边采用上游的 handle，并保留无页面时的载体。** 上游的 `ClientStreamHandle` 在构造时预读下行，这正是让它的 `open` 帧先于任何 `send()` 的机制；同一次预读还会在调用流方法时解析 Connection，因此缺少传输会在调用处抛出，而已退役命名空间的首次读取会在等待载体之前报出 `Remote method <endpoint> is no longer mounted`，未被读取的流因而永远不会等待一个已经不存在的 Host。上游只按 `document.baseURI` 解析复用 socket，而该值只存在于页面内；本 fork 的载体也会在没有页面的环境中运行，因此 `remoteStreamUrl` 依次尝试传输的 `streamBaseUrl`、文档基址、`location.origin`，最后回退到 `http://dsh.internal`。

**边界取值由 Host 拒绝。** `requireStrictInputs` 在挂载时拒绝没有严格 codec 的描述符，而 Host 会把每一个线上字段——调用身份、参数、上行项——都经 `codec.create().parse(value)` 解码，并以 `gateway/input-invalid` 拒绝。因此客户端原样转发取值，自己只负责参数个数、Context 适配器、Connection 存活与描述符严格性。被取消的转发事件同样由 Host 兜底：客户端一旦观察到 Host 的 `cancel` 帧就不再回复，而 Host 不再等待的回复在 `receiveRemoteEventResult` 中是幂等空操作。

**RPC 附件不做成帧。** 上游把处理函数返回的二进制附件放进 multipart 响应。本传输只承载 JSON，且本仓库没有任何 codec 会投影附件，因此 `ConnectionRpcAttachment` 保留在处理函数契约中，而 `fullResponse` 会拒绝携带附件的返回值，而不是用 `null` 占位符作答。二进制载荷继续走精确 Fetch 路由。

## 刻意的搁置

**Office 线。** 未引入上游的 Office 客户端包，也没有任何 bundle 挂载它们；本 fork 交付自己的插件清单页。

**三个未挂载的上游客户端包。** `client-ui-cot-translation`、`client-ui-voice-input` 与 `ui-plugin-manager` 与 Office 线一样被搁置：没有 bundle 挂载它们，且它们的 slot 席位只存在于上游的客户端包中，本地声明这些 slot 只会留下死注册。

**上游的 `session-inspector` 与 `inspector-profile`。** 开发者检查界面出于同样的原因被搁置：它的对话分组展示是针对上游的 conversation group engine 编写的——`ConversationGroupedView`、`GroupKey`、`GroupSnapshot`、`NodeReference`、`RenderEntry`、`snapshot.views.grouped('chat')`、`conversation/group-store.ts`、`ConversationBinding.openTurn` 与 `ChatSnapshotBuilder.publish`——而这些在本 fork 的 `ui-conversation` 与 `ui-chat` 中都不存在。移植它意味着把上游的 conversation 架构引入两个完全由本 fork 拥有的 UI，因此该包、它的 `inspector-profile` 组合包、该组合包在 `OPTIONAL_BUNDLES` 中的行、客户端 slot 目录中的占用项、两个 tsconfig 聚合、路径别名、清单依赖与组合参考表中的行一并移除。若将来采纳上游的 group engine，检查界面随之回归。

**上游的 `tool-schedule`。** 合并最初保留了 fork 自己的 schedule 插件，并把上游的两个期望 spec 移植到 fork 的 `after`/`at`/`every` 模型上。该搁置决定已被撤销：fork 的模型整体退役，改为采纳上游的 `ScheduleService` 线路——宿主包、`tool-schedule`、带 `schedule/changed` 转发事件的 `scheduleRemote` Remote 贡献、客户端与 spec。该撤销由被采纳的 [Host Schedule 存储](2026-09-16-host-schedule-storage.zh.md)决策与 [preset 级提醒工具](2026-09-24-preset-scoped-schedule-tools.zh.md)决策记录；fork 的会话日志权威说明已归档至[持久定时提醒](../../archived/feature/2026-08-05-durable-web-schedule.md)。

**preset 目录打开表面。** 合并后的 `AgentPreset` 不携带 trust 与 path，因为上游用「在 `cordis.yml` 中声明 preset」的注册表取代了 fork 那个会自行发现目录的 agent-presets 包；打开用户自撰的 preset 目录因此没有数据来源。该表面被端到端移除——两个 preset 打开的 Remote 方法、SettingsController 的 `nativeOpen` 字段、`canOpenPath`、`AgentPresetDirectoryOpenValue`、`agent-preset/read-only` 错误码、connection fixture 的分发条目、`ui-agent-preset` 的位置入口及其 locale 与 CSS，以及仅覆盖它的那些用例。若 Host 侧的 `deletePreset` 回归，请恢复 `agent-preset/read-only`。

**上游的 `remote-mock`。** gateway 的上游客户端 spec 需要 `@deepseek-ai/dsh-remote-mock`，一个本次合并从未引入的测试支持包；把它声明为 `workspace:*` 依赖会让 `pnpm install` 直接失败。因此保留 fork 的 `gateway.client.spec.ts` 并去掉该依赖；它跑在 spec 自带的 fixture 上，断言的是客户端半边自身的职责——挂载、参数个数、适配器、存活、描述符严格性、载体生命周期、上行成帧——而不是某个替身装配。

**取自上游的包所携带的运行时不变式伴生组件。** 上游退役了整个运行时不变式插件体系，因此本次合并从上游采纳的每个包都失去了 fork 曾为它添加的 `./invariant` 伴生组件：共 29 个，分布在 `core/{agent,agent-loop,scope,session,system-prompt,tools}`、`llm/{llm,llm-retry}`、`settings`、`workspace`、`jobs`、`compaction`、`interaction/*`、`credentials/*`、`goal/*`、`plan-mode`、`sandbox-policy`、`schedule`、`storage-domain`、`subagent/*`、`tool-todo`、`agent-presets`、`hook-protocol` 与 `time-context`。fork 仍自有的包保留各自的伴生组件——共 11 个——而这里采纳上游的退役而不是逆转它，因为恢复其余部分等于重新发布一个上游整体移除的机制。代价是 fork 自己的网关要求的那句省略理由：`verify-package-invariants` 会从每个包的 README 中读取它，而 145 个上游采纳的 README 都没有，因此现在每个都写明自己的包贡献什么、以及它不检查的那层关系由哪个服务持有。

**base 组合中的 `plugin-manager` 行。** 上游的 base 挂载 `@deepseek-ai/dsh-plugin-manager`，并以 `!ctx.get('profileContext')` 守卫。本 fork 的任何 bundle 都从未挂载它——fork 顶点同样是这个缺失，所以这是组合选择而非合并损伤——而它在本树中的消费方是 `packages/api/remotes` 与 `packages/host/plugin-inventory`，二者经 `ctx.get` 取用，在没有 profile 提供时会降级。因此是否挂载属于「默认 profile 提供什么」的产品决定，而不是一次收敛。

## Alternatives considered

- **保留 fork 自己的 settings provider 接缝。** 已否决：上游从 Loader 组合派生命名空间，这也正是插件无需注册调用即可出现其 section 的原因；两者并存会让同一个 section 出现两个权威。
- **保持 V3 时代的会话格式版本。** 已否决：合并后的会话族、session-format catalog、迁移与 web profile 全面处于 v4，把 JSONL 后端固定在 v3 就必须回退 `createSystemMessage`、消息来源词汇以及已引入的迁移边。
- **改写上游测试以适配 fork 的 `win32-process` API，而不是移植缺失的访问器。** 已否决：`sandbox-windows-acl` 的失败路径 spec 来自上游，而它校验的原生布局正是 fork 的即时绑定已经物化的那一个；一行访问器即可让两侧同时通过编译，无需重写 spec。
- **删除 job 镜像而不接线。** 已否决：`ui-jobs` 在该镜像之上渲染且 Web profile 挂载了它，上游所做的删除会移除一个已交付的头部。
- **把每个请求都接纳为 operator。** 已否决：那样 `admit` 会把 operator Peer 交给配对设备，而设备 cookie 本就弱于启动令牌。改为把 gateway 的调用适配到 fork 的权限类别，并用一个「设备被当作 operator 即失败」的用例钉住该性质。
- **保留 fork 的 worker-thread 工作流引擎。** 已否决：上游的[工作流沙箱复用](2026-09-13-workflow-ptc-sandbox-reuse.zh.md)已经退役该执行基座，它的挂载、目录与消费方都是上游的，而同时保留两个引擎会让同一个接缝出现两个权威——合并后的树把两者都导入了，却只挂载了其中一个。
- **整体采纳上游的 `dsh-client-connection`。** 本次合并已否决：那会替 fork 的配对设备登记表做决定，而它是 fork 自己的安全表面，不该在合并中顺带定夺。改为把 gateway 的五个 Connection 调用点适配到 fork 的接缝。

## Consequences

- gateway/remotes 这一对已收敛到上游的流协议，两个包的测试族均已转绿：`gateway.host.spec.ts`、`gateway-stream.host.spec.ts`、`echo-stream.host.spec.ts`、`stream-server.host.spec.ts`、`stream-protocol.host.spec.ts`、`remote-event-protocol.host.spec.ts`、`control-retry.client.spec.ts`、`journal-stream.client.spec.ts`、`gateway.client.spec.ts`（106/106），以及 remotes 的两个文件。客户端 spec 并不需要 `@deepseek-ai/dsh-remote-mock`，见「刻意的搁置」。
- web 通道已抵达其断言：`apps/web/tests/archived-sessions-settings.e2e.ts` 通过——归档设置行、`Archived YYYY-MM-DD` 归档时刻、恢复流程与确认后的递归删除——`startup-auto-selection.e2e.ts`（2/2）同样通过。为此落地了两件事：输入框的 Access 席位改读合并后的权限模型（下一段），以及孤立转录的准备器把 V3→V4 边绑定到空子集——`prepareSessionSnapshotFixtureForComparison` 现在经由 `createSessionFormatCatalogWithChildren([])` 恢复，因为静态 catalog 的「仅头部」声明会拒绝任何历史正文。产品路径不受影响：`session-persistence-jsonl` 通过 `prepareCatalogFacts` 收集真实的直属子 Session 事实。
- 输入框的 Access 席位读取合并后的权限模型。Host 把当前选择放在 `permissions` 会话投影上、把可选预设放在 `permissionPresets.catalog()` Remote 上，因此 `InputBar` 在席位处合并两者：`PermissionCatalogSeat`（`packages/client/ui-conversation/src/client/permission-catalog.ts`）通过已挂载的 Remote 读取目录，在转发事件 `permission-presets/catalog-changed` 上重读，并把预设发布到输入框的 `hooks` 舱位。投影缺失、目录尚未到达、或会话缺少命令面时，席位都不渲染；读取失败或被拒时保留上一次的预设，而不清空一个正在使用的席位。
- `packages/client/connection` 承载 fork 的调用方 Peer：operator 一个、每台已接纳设备各一个，凭据不属于任何一类的调用方没有；`node-half.host.spec.ts` 钉住该性质——配对设备被接纳为它自己的 Peer——若把 operator 的 Peer 交给设备，该用例即失败。
- Agent Team 包已转绿：`team.spec.ts` 48/48、`persistence.spec.ts` 5/5，而接纳移植之前为 9 failed | 44 passed。
- `packages/sdk/server` 在合并后的 Messages 适配器上全绿（3 个文件、39 条测试）；该包与 `llm-deepseek` 都不再出现 `reasoning_effort`。
- `packages/subprocess` 除 `spawn-runner.spec.ts` 中两条 `EPERM: operation not permitted, symlink` 外全部通过，本机在未开启开发者模式时无法运行它们。`terminal/terminal` 的 21 处注册重新 `await ctx.agents.register(…)`，因此该套件为 23/23；上游的注册表在更晚的一次 tick 上发布，而合并丢掉了这些 await。`sandbox-windows-acl/tests/runner.spec.ts` 保留了十条在本机解析不到 `pwsh` 的用例——`Get-Command pwsh` 找不到任何结果，`$PSVersionTable` 为 5.1，`candidatePwshPaths()` 最终落到 `…\WindowsPowerShell\v1.0\powershell.exe`，它无法通过套件的 `/pwsh(\.exe)?$/u` 检查，而同一套件的 `pwshAvailable()` 探测却接受这个回退。它的 `control.spec.ts` 还保留两条控制台可见性用例：恢复的接线就是上游的，但在拥有可见控制台的会话里，运行器第 4 槽位上的裸 NUL 描述符会使 `windowsHide` 失效，该断言由 CI 的无控制台通道负责。
- `packages/session/session-persistence-jsonl` 承载历史世代迁移：`catalog-migration.ts`、它在 `src/index.ts` 中的消费边，以及 `@deepseek-ai/dsh-session-format-v3-to-v4` 的 manifest 依赖均已就位并安装。该包实测 777 passed | 10 skipped，其中两条失败与主机绑定：`generation.spec.ts` 的碰撞符号链接目标需要开发者模式；`catalog-migration.spec.ts` 的父子延后用例在 `--testTimeout=60000` 下通过——每个参数化约六秒——而五秒默认值会超时；同一文件中的其他用例都在默认值之内。
- 客户端编译面在 `pnpm exec tsc -b tsconfig.client.json --force` 下干净通过。`packages/experimental/client-ui-claude-code-mods` 没有 `src/css-modules.d.ts`，于是 `Band.tsx` 的 CSS Module 导入在该包自身的工程内失败，而根程序通过 `packages/client/*/src/css-modules.d.ts` 能解析同一文件；现已补上该声明，并在聚合里与 `ui-cordis`、`notes` 并列列出。非 force 构建会重放 `.tsbuildinfo`，这正是该失败被掩盖的原因。
- `packages/session/session-persistence-jsonl/package.json` 现在声明 `@deepseek-ai/dsh-session-format-v3-to-v4`；需要执行 `pnpm install` 才能物化该 workspace 链接。
- `packages/workflow/workflow-ptc` 与 `packages/ptc-runtime/ptc-runtime-node` 能在本树的组合中执行：19 个文件、317 条测试通过，`tool-workflow` 的真实引擎用例与 `tool-ralph` 的八轮集成都跑完了一个沙箱化 PTC 进程。仍有一条为红——`runtime.spec.ts` 的 `retains console output emitted immediately before a non-yielding program` 得到 `[]`，而它期望 `['before hot loop']`，即先打印再忙等的程序可能在运行时按截止时间终止它之前丢掉那一行。
- `tool-terminal` 通过已采纳的 `JobSpec.output` 拉取源读取后台发送（`packages/terminal/tool-terminal/src/background.ts`），也就是本树中所有其他生产方使用的那个接缝；它的生产方只返回 `cancel` 与 `done`。
