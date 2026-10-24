# Agent Note：已归档会话的归档时刻与递归删除经 Workspace、Session Remote 落地

Status: implemented

[English](2026-10-17-archived-instant-and-recursive-delete.md) | 中文

## 问题

上游合并后，fork 的两项能力都没有运行时出口。[归档时刻笔记](../feature/2026-08-21-archived-details-and-archive-times.zh.md)描述了一张抵达已归档设置页的 `archivedSessionAts` 映射，[递归删除服务](../../../../packages/session/session-deletion/README.zh.md)描述了一个 `ctx.sessionDeletion` 编排器，但合并后的树两者都没交付：注册表保留了归档时刻，协议却把它丢掉；删除插件没有挂在任何 profile 里。

两项能力走同三层（持久注册表 → Remote → 已归档设置页），因此由一条记录统一承载它们在合并架构上的实现，而不是拆成两条各说一半。

## 决策

**Workspace Remote 把归档时刻与归档 id 一并给出，Session Remote 用一个薄映射把 `delete` 交给可选的 `ctx.sessionDeletion` 服务。**

- Workspace Remote：`WorkspaceBaseline`、`archived` 跟随增量与 `WorkspaceArchiveValue` 都增加 `archivedSessionAts`，与 `archivedSessionIds` 键相等。`WorkspaceFeed` 同时比较 id 列表与时刻映射，因为取消归档后再归档会给同一个 id 重打时刻而不改变集合。
- 客户端：`WorkspaceSnapshot.archivedSessionAts` 跟随 baseline、一元归档响应与流帧；`sameArchiveInstants` 决定是否重新发布，映射未变时已发布的快照引用保持不变，重打时刻则发布会新快照。
- 已归档页：每行在标题下方按字典的 `date.ymd` 模板渲染 `归档于 {date}`；在时刻字段出现之前归档的会话显示"归档时间未知"占位符。详情对话框把归档时刻加入其固定字段列表。
- 删除：`session.delete({ sessionId, recursive })` 返回 `deletedSessionIds`。该方法用 `ctx.get('sessionDeletion')` 读取而不是注入，因此没有挂载该服务的部署回答 `session/deletion-unavailable`，其余会话动词照常工作。服务的封闭错误码映射为 `session/running`（携带 `runningSessionIds`）、`session/has-descendants` 与 `session/not-found`；其他失败保持 `gateway/internal`，存储故障不会被读成业务拒绝。
- 组装：`packages/bundle/web-app` 在 `workspace` 旁边挂载 `session-deletion`，清理要写的注册表本来就在这一层。两者都省略的 profile 就没有删除入口。
- 客户端删除：`sessions.deleteSession` 发送 `recursive: true`，随后拉取列表 baseline，让被删除的行离开所有界面。已归档页先确认，调用挂起期间禁用两个控件，Host 拒绝时保持对话框打开并显示失败消息。

## 考虑过的替代方案

**在客户端自己记录归档时刻。** 否决：两个浏览器会对"何时归档"给出不同答案，重连后这一事实会彻底丢失。时刻必须随归档集合持久化。

**把 id 数组换成 `{ id, at }` 条目。** 已被[此前的笔记](../feature/2026-08-21-archived-details-and-archive-times.zh.md)否决：任何 schema 默认值都无法升级旧介质，而且纯数组的每个消费方都要跟着改。

**把删除服务挂到 base bundle。** 否决：`session_deletion` 只在用户显式操作时写入的持久状态，没有删除入口的 profile 不应打开该域。Web bundle 是当前唯一调用方。

**只做非递归删除，由客户端展开。** 否决：部分失败会留下父级已消失的孤儿子孙。服务在第一次破坏性写入前推导出完整计划；客户端只发一个请求。

## 结果

已归档页能回答会话何时被封存，并能删除一个会话及其子代理子树，既不会编造时间戳，也不会留下孤儿子孙。旧归档保留"归档时间未知"占位符，因为不存在可信值。证据：Session Controller 套件钉住错误码映射，Workspace Controller 套件钉住时刻传播，组件测试钉住行内日期与确认约定，`apps/web/tests/archived-sessions-settings.e2e.ts` 在组装后的应用里对真实 Host 驱动这两项能力。
