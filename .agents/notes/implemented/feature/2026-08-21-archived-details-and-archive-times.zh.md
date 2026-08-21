# Agent Note: Archived settings details dialog and archive timestamps

Status: implemented

[English](2026-08-21-archived-details-and-archive-times.md) | 中文

## Problem

已归档设置页此前每个已归档会话只显示一个标题。用户无法知道会话何时被归档，也无法在不恢复的情况下查看其归档前的上下文（工作区分组、cwd、Agent 预设）。按归档前工作区分组早已可用——[归档集合笔记](2026-07-31-session-archive-global-set.md)保留了被归档会话的 `sessionIds` 席位——但归档时刻本身没有任何记录。

## Decision

**一个带默认值的 `archivedSessionAts` 映射伴随归档集合贯穿全部四层；已归档页在每行行内显示归档日期，并提供固定字段的详情对话框。**

- 持久化：`workspaceDomainState.archivedSessionAts`——`z.record(sessionId, z.string()).default({})`，键集合与 `archivedSessionIds` 保持一致（归档时写入 `new Date().toISOString()`；unarchive 与 forgetSession 删除对应条目）。这沿用归档集合自身的增量默认值先例，因此域版本保持 2，字段出现之前的介质解析为空映射；此前归档的会话没有时间戳，UI 如实显示而不是伪造。
- 线协议：`workspace.list`、两个归档一元响应以及 `host/archived-sessions-changed` 帧各自把 id 集合与完整映射配对。由于映射与集合键一致，发布方现有的数组比较仍能检测全部变更。
- 客户端运行时：`WorkspaceListState.archivedSessionAts` 通过与 id 集合相同的三条路径安装（list 基线、一元回声、变更帧）。
- UI（`dsh-client-ui-settings-archived`）：每行在标题下方渲染归档日期（`row.archivedAt` 套用 `date.ymd` 字典模板——消息时钟模式，绝不用会跟随浏览器语言的 `toLocaleString`）；早期归档显示"归档时间未知"占位。详情按钮（`IconInfoOutline16`，位于恢复左侧）打开固定字段对话框：分组、目录、Agent 预设、归档时间、最后活动、状态、子代理对话数、会话 ID。`ArchivedRow` 携带对话框所需的全部摘要字段，因此对话框不查询任何 store，也不引入难以覆盖的可选链。

## Alternatives considered

**把 `archivedSessionIds` 改为 `{ id, at }` 条目数组。** 否决：没有任何 schema 默认值能升级字段出现之前的介质，且纯 id 数组的每个消费方都要改动；并行的带默认值映射正是该字段自身的先例。

**用户可配置的详情字段。** 与用户确认后否决：一个固定集合已覆盖所述需求；持久化显示偏好是缺乏需求证据的新机制。

**行内日期使用相对时间（活动行的模式）。** 否决：归档日期是查找键（"我哪天搁置的它"），绝对日期比"3 天前"更便于扫读。

## Consequences

已归档页无需恢复往返即可回答会话何时、在哪里被搁置。早期归档静默缺少时间戳（显示为未知）——可以接受，因为不存在可信的值。e2e 场景通过组装后的应用固定行内日期与对话框；域、线协议 schema、运行时与组件测试各自固定本层。跨层字段命名保持统一（`archivedSessionAts`），一次 grep 即可到达每一跳。
