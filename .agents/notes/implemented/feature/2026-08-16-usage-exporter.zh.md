# Agent Note：基于本地遥测 JSONL 的可选 usage exporter

Status: implemented

[English](2026-08-16-usage-exporter.md) | 中文

## 问题

`@deepseek-ai/dsh-usage-telemetry` 把每次带 session 归属的模型调用记录到本地 JSONL。DeepSeek Monitor 只有与 dsh 共享同一文件系统时才能读取该文件。远程和多机看板需要 dsh 主动推送。

## 决策

`@deepseek-ai/dsh-usage-exporter` 是默认禁用的 Host 插件。它不订阅 `llm/stream`，而是以 offset 游标 tail `$DSH_HOME/telemetry/usage-*.jsonl`，构造确定性 batch（`batchId = sha256(sourceId, file, startOffset, endOffset)`），并 POST 到 Monitor 的 `POST /api/v1/dsh/usage`。Monitor 契约还携带 `rootId`（规范化遥测根哈希），供 auto 采集模式抑制同一根目录的文件轮询；heartbeat 信封在空闲期间续租 push 租约。

batch 使用同一个 `batchId` 最多重试 `maxAttempts` 次，随后判定为 abandoned 并推进游标；本地文件仍是回填来源。游标持久化在 `$DSH_HOME/storages/usage-exporter.json`，仅在确认、重复、永久拒绝或放弃后才推进。

## 备选方案

**从 usage-telemetry 派发进程内事件流。** 否决：本地 JSONL 已经是有序且持久的事实来源，tail reader 不增加与捕获核心的耦合。

**只 push、不落盘。** 否决：失去本地文件就失去了重放和回填能力，exporter 会对每个 dsh 实例变成强依赖。

## 影响

- 随附 Web 组合保持 `disabled: true`，部署方按 profile 选择启用。
- push 与文件扫描可借助 Monitor 的 `rootId` + 采集模式 + 租约规则共存且不重复计数。
- endpoint/token 配置为 secret role，永不写日志；非回环端点必须使用 HTTPS。

## 测试

- `packages/telemetry/usage-exporter`：config schema/默认值、游标存储原子持久化/清理、tail 的 EOF 快照/新文件/截断/畸形行行为、sender 分类（accepted、duplicate、401 永久、5xx 重试、heartbeat）、apply 轮询/推送/游标推进，以及 Web bundle 的禁用行。
