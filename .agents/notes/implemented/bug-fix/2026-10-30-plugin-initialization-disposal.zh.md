# Agent Note: 异步初始化前确定插件资源的所有权

Status: implemented

[English](2026-10-30-plugin-initialization-disposal.md) | 中文

## Problem

游标或存储域加载期间，插件可能开始卸载。如果在 await 之后注册清理，已卸载的 fiber 会抛出 `INACTIVE_EFFECT`，导致新建的定时器继续运行或域名保持占用。存储设施仍挂载时，重新启用 Notes 或 Session Pins 就会因 `already-open` 失败。

## Decision

用量导出器、Notes 域拥有方和 Session Pins 在开始初始化前注册异步 Cordis effect。这些 effect 按照[运行时所有权规则](../architecture/2026-07-12-agent-scope-runtime-design.zh.md)，负责清理直至初始化和卸载完成。存储获取通过已有 effect 返回关闭用的 disposer，包括打开操作尚未完成时拥有方已被卸载的情况。域设施保持句柄由调用方拥有的策略。

导出器在加载游标后检查其 fiber；如果 fiber 已卸载，就不启动定时器或请求。其 effect 先停止两个定时器，再等待批次和心跳任务完成。Session Pins 只在其 fiber 仍挂载时发布 global 和标记 provider，并在关闭域时清除就绪状态。

## Alternatives considered

**获取资源后捕获 inactive-effect 错误。** 捕获错误并不能为资源指定拥有方或关闭域。必须在 await 之前确定所有权。

**将所有域绑定到存储设施的 fiber。** 设施比单个消费方存活更久，卸载某个消费方后仍会保留其占用，阻止重新加载。返回的句柄及其清理由消费方拥有。

**为每个初始化器添加独立的取消控制器。** Cordis 已经会等待进行中的 effect 初始化和卸载。第二个控制器没有新的操作或完成点需要拥有，只会增加状态。

## Consequences

卸载会等待初始化完成，不会取消存储后端的打开操作。迟到的句柄会在卸载完成前关闭，消费方可以在不重启存储的情况下重新加载。测试用显式屏障暂停初始化，卸载消费方后再释放初始化，并验证域可以重新打开、标记已移除，以及导出器卸载后不再发送请求。正常重新加载也覆盖同一组拥有方。
