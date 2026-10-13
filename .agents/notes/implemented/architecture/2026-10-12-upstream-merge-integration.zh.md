# Agent Note: 上游 0.2.1-alpha.2 合并的集成决策

Status: implemented

[English](2026-10-12-upstream-merge-integration.md) | 中文

## Problem

本 fork 将上游 0.2.1-alpha.2（`upstream/master` `d743267388`）合并进一棵已在会话族、shell、subagent 平面、settings 平面与 job 镜像上大幅分叉的树。上游替换了 fork 若干特性赖以建立的接缝——jobs 通知 API、settings provider 接缝、`SubagentRuntime` 的续接入口、消息来源词汇、会话日志格式——同时还带来了本 fork 没有消费方的若干表面。每条接缝都要做出选择：把 fork 的行为移植到新 API 上、接受上游的替代并删除 fork 的版本，或将上游的表面搁置。采用上游的 `SESSION_FORMAT_VERSION = 4`、却让 JSONL 扫描器继续以 V3 规则接纳当前世代的物理行，导致每个含 system 消息的会话日志都不可读；这一缺陷最先以 Agent Team 包中九个冷恢复失败的形式暴露。

## Decision

把 fork 的行为移植到合并后的 API 上，在 fork 的代码就是存续实现的包内保留 fork 独有实现，并搁置本树无人挂载的上游表面。以下各节记录塑造了已交付行为的四处移植、settings 与会话格式的迁移，以及刻意未采纳的内容。

## Job 变更改走合并后的 jobs 事件流

fork 的 `SessionControlController` 按会话镜像后台 job，`ui-jobs` 在该镜像之上渲染其头部，因此按上游的做法删除接线等于删掉一个已交付特性。合并后的 jobs 服务用经过过滤的事件流取代了 `onJobsChanged(owner)`，于是 `packages/api/session-controller/src/control.ts` 以 `events.subscribe({ owners: 'all' }, …)` 订阅，忽略不改变任何已发布行的 `output` 与 `progress` 事件，并在对应旧通知点的生命周期提交上重新发布。job 查询传入 `SessionId`（`jobs.list(caller)`）而非 `Agent`，与合并后的注册表一致：无属主的 job 对每个调用方可见，有属主的 job 对该会话可见。

## subprocess 控制通道是一次增量移植

fork 的可靠性工作需要一条与 stdio 并列的字节通道。`packages/subprocess/subprocess/src/control.ts` 拥有该协议：描述符 `SUBPROCESS_CONTROL_FD` 为 7、私有启动标记 `DSH_SUBPROCESS_CONTROL`，以及 `openInheritedControlChannel()`——它消费该标记并在继承来的描述符上返回字节模式双工 socket。`SubprocessStdio` 新增可选的 `control?: 'pipe'` 请求，`SubprocessHandle` 新增可选的 `control` 双工流，因此未请求该通道的启动器不受影响。Windows 启动路径通过 `packages/subprocess/win32-process/src/control-stdio.ts` 承载同一条通道，`sandbox-windows-acl` 则把既有的 fd 7 转发给受限子进程，并在使用管道 stdio 时拒绝 control。

## 会话删除经 workspace 注册表执行遗忘

`packages/workspace/workspace` 暴露 `registry.forgetSession(sessionId)`，因此 `session-deletion` 在删除计划的 workspace 环节调用它，并把该成员推进到 `done`。消费方不为「注册表缺少该方法」携带任何补偿：当 `workspaceRegistry` 缺失时，该成员被标记为 `skipped`，由持久化计划记录这一结果。

## subagent 的 working directory 注入

合并后的 `SubagentRuntime` 通过 `ctx.workingDirectory.ensure(parent, signal)` 解析每个子会话的目录，因此该服务属于它的注入集合。挂载了 subagent runtime 却没有 `dsh-working-directory` 的组合会让每次启动与每次冷恢复停在挂起状态，而不是显式失败：基础 bundle 挂载了它，测试则挂载共享的 `mountWorkingDirectoryFixture`。

## settings 命名空间来自组合

上游替换了 settings provider 接缝：`SettingsForms` 依据每个活跃 Loader 条目导出的 `Config` schema 为其派生一个命名空间，于是插件声明自己的 section，而不再调用 `ctx.settings.register()`。本 fork 选择迁移消费方而非恢复该接缝——`settings-controller` 引入 `SettingsForms`、用呈现映射填充 `autoGenerate`，并在 `RemoteErrorDetailsMap` 中声明 `agent-preset/read-only`；`mcp-manager` 声明一个 volatile 的 `Config` 字典，并把其声明式交叉校验移入受活跃 fiber 约束的内部 `config` waterfall 监听器，从而保留 fork 的写入拒绝与已存 section 兜底。

## 会话格式 v4 接纳

合并不但采用了 `SESSION_FORMAT_VERSION = 4`，还引入了 `packages/session/session-format-v3-to-v4`；但合并原样保留的 fork 版 `packages/session/session-persistence-jsonl/src/format.ts` 仍在用 `assertV3RowAdmission` 接纳当前世代的物理行，且从不运行 `assertReleasedV4Relationships`。V3 接纳要求 `system/message` 的来源为 `kind: 'plugin'`，而合并后的 `createSystemMessage` 写入的是 `kind: 'system-prompt'`，于是扫描器拒绝循环写出的每一个日志，所有回读路径随之失败。本次移植把上游的三行重新落到 fork 的扫描器上：导入块中的 `KNOWN_SESSION_EVENT_TYPES`、`consumeEventLine` 中的 `assertV4RowAdmission(decoded, KNOWN_SESSION_EVENT_TYPES)`、`finish()` 中的 `assertReleasedV4Relationships(artifact, KNOWN_SESSION_EVENT_TYPES)`，以及指向 `dsh-session-format-v3-to-v4` 的依赖、项目引用与聚合引用。

## 归档时刻在生产方恢复

上游注册表从不携带归档时刻——`git log -S archivedSessionAts upstream/master` 为空，其 `archivedSessionIds` 只有归档顺序。合并从上游取了 `packages/workspace/workspace/src/{index,spec}.ts`，却保留了 fork 的 `workspace-controller` 线格式与 Client 层，于是 `packages/api` 下 49 处读取点与 `ui-settings-archived` 读取一张没有生产方写入的映射；该包自身 host 规格中的两个失败用例即为症状。本次在上游注册表上增量恢复 fork 的生产方：`workspaceDomainState.archivedSessionAts`（`z.record(sessionId, z.string()).default({})`），由 `archiveSession` 在同一次清除置顶的持久写入中打戳，并由 `unarchiveSession` 与 `forgetSession` 删除。上游的归档动词、归档准入事件与置顶集合均未改动，领域版本仍为 2，因为该字段对旧介质有默认值。

## 刻意的搁置

**Office 线。** 未引入上游的 Office 客户端包，也没有任何 bundle 挂载它们；本 fork 交付自己的插件清单页。

**三个未挂载的上游客户端包。** `client-ui-cot-translation`、`client-ui-voice-input` 与 `ui-plugin-manager` 与 Office 线一样被搁置：没有 bundle 挂载它们，且它们的 slot 席位只存在于上游的客户端包中，本地声明这些 slot 只会留下死注册。

**上游的 `tool-schedule`。** fork 保留自己的 schedule 插件，并把上游的两个期望 spec 移植到 fork 的 `after`/`at`/`every` 模型上，而不是采纳上游的 `ScheduleService`。

**preset 目录打开表面。** 合并后的 `AgentPreset` 不携带 trust 与 path，因为上游用「在 `cordis.yml` 中声明 preset」的注册表取代了 fork 那个会自行发现目录的 agent-presets 包；打开用户自撰的 preset 目录因此没有数据来源。该表面被端到端移除——两个 preset 打开的 Remote 方法、SettingsController 的 `nativeOpen` 字段、`canOpenPath`、`AgentPresetDirectoryOpenValue`、`agent-preset/read-only` 错误码、connection fixture 的分发条目、`ui-agent-preset` 的位置入口及其 locale 与 CSS，以及仅覆盖它的那些用例。若 Host 侧的 `deletePreset` 回归，请恢复 `agent-preset/read-only`。

## Alternatives considered

- **保留 fork 自己的 settings provider 接缝。** 已否决：上游从 Loader 组合派生命名空间，这也正是插件无需注册调用即可出现其 section 的原因；两者并存会让同一个 section 出现两个权威。
- **保持 V3 时代的会话格式版本。** 已否决：合并后的会话族、session-format catalog、迁移与 web profile 全面处于 v4，把 JSONL 后端固定在 v3 就必须回退 `createSystemMessage`、消息来源词汇以及已引入的迁移边。
- **改写上游测试以适配 fork 的 `win32-process` API，而不是移植缺失的访问器。** 已否决：`sandbox-windows-acl` 的失败路径 spec 来自上游，而它校验的原生布局正是 fork 的即时绑定已经物化的那一个；一行访问器即可让两侧同时通过编译，无需重写 spec。
- **删除 job 镜像而不接线。** 已否决：`ui-jobs` 在该镜像之上渲染且 Web profile 挂载了它，上游所做的删除会移除一个已交付的头部。

## Consequences

- Agent Team 包已转绿：`team.spec.ts` 48/48、`persistence.spec.ts` 5/5，而接纳移植之前为 9 failed | 44 passed。
- `packages/sdk/server` 仍保留一条失败断言：它期望 `body.reasoning_effort === 'max'`，而合并后的 DeepSeek 适配器使用 Messages 线格式。该断言属于 `packages/llm/llm-deepseek`，在做出该决定前保持红色。
- `packages/subprocess/subprocess-local/tests/control.spec.ts` 在 Windows 上仍有六个用例中的两个为红，分别是 `handle.done` 与 `once(channel, 'data')` 上的超时；通过的四个包含 256 KB 二进制传输，接线本身保持不变。
- fork 的 V3 时代 `session-persistence-jsonl` spec 仍在描述合并前的迁移路径：合并后的 JSONL 后端没有可用的历史世代迁移（上游的 catalog-migration 消费方未随其迁移边一并采纳），因此 v0/v2/v3 夹具被拒时的消息与这些 spec 的断言不符。该工作流与接纳移植相互独立，仍未完成。
- `packages/session/session-persistence-jsonl/package.json` 现在声明 `@deepseek-ai/dsh-session-format-v3-to-v4`；需要执行 `pnpm install` 才能物化该 workspace 链接。
