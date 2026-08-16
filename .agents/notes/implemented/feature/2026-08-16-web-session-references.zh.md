# Agent Note: Web session references through composer `@`

Status: implemented

[English](2026-08-16-web-session-references.md) | 中文

## Problem

Web composer 已有 `@` 触发流水线，宿主也已有 `@deepseek-ai/dsh-session-reference` 提供有界跨会话快照，但 Web profile 没有选择工作区会话并把其快照附着到消息的入口。会话间任务交接只能手动复制或恢复源会话。

## Decision

两个插件接通既有组件。`@deepseek-ai/dsh-session-reference-admission` 注册最外层 `agent/pre-step` 监听器，解析直发消息中的规范 `dsh-session:` 提及；它经 `ctx.sessionQuery.listSessions` 把每个源会话的 `cwd` 与当前会话重查，调用 `ctx.sessionReferenceResolver.prepare`，把直发消息替换为可读的 `@label` 文本并保留 id 与 source，再把快照消息插到其正前方。`@deepseek-ai/dsh-client-ui-session-reference` 在热着的 `ctx.sessions.list` 上注册 `@` `session` input-trigger source：同 cwd、非 blank、非 subagent 且排除当前会话，上限 50，`order: -1`。选中后插入结构化 `ReferenceInsert` chip，其 codec 序列化规范提及。

失败按 fail-closed 处理：malformed 提及、不可读源、预算或上限错误从 pre-step 抛出，轮次以错误卡片结束且不发送部分上下文。浏览器 codec 在提交前对 ready 列表重新校验所选会话，提前失败时保留草稿。

Web bundle 挂载三行：`session-reference`、`session-reference-admission` 与 `ui-session-reference`。apiproxy、wire schema、输入状态机与 `InputTriggerCandidate` 保持不变。

## Alternatives considered

- **在 apiproxy prompt handler 内准备快照** — 被否，因为会把 Web 专用准入放进核心网关，并重复 TUI 的 pre-step 路径。
- **扩展现有 subagent `@` source** — 被否，因为纯标题文本无法唯一标识会话，还会绕过规范 URI 与快照信任边界。
- **浏览器纯文本提及而不使用 chips** — 被否，因为输入机的 chip 路径已经提供 occurrence 身份、标签与 codec 序列化。

## Consequences

快照保持发送时点冻结、只读、有上限并带警告。pre-step 准入意味着其他 pre-step 监听器看到原始规范提及文本，源会话在发送后被删除会以 turn error 呈现，而不是 RPC prompt 错误。移除三行 bundle 配置即移除该功能。
