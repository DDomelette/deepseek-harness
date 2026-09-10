# Agent Note: Explicit Session deletion alongside historical migration

Status: implemented

[English](2026-09-10-explicit-session-deletion-and-migration.md) | 中文

## Problem

永久删除必须移除所有存储代际，避免后续读取重新发现旧副本。历史迁移也访问这些文件，但仅观察会话必须保留已提交数据。

## Decision

**显式删除持有共享写锁，只读迁移准备保持不修改文件。** JSONL 后端按从旧到新的顺序删除附件及代际，清除解码日志缓存，并保留 POSIX 锁文件。既有写入者跨后端实例排除删除。只读准备不发布文件；写模式打开会在同一写锁内验证源修订并发布后继代际。

[相邻迁移策略](2026-08-31-released-session-format-migrations.zh.md)和[只读准备决策](2026-09-05-read-only-session-migration-preparation.zh.md)继续约束迁移。它们不授权清理保留数据；删除必须通过持久化删除 API 显式请求。

## Alternatives considered

**移除显式删除以保留所有历史产物。** 否决，因为永久删除是必需的用户操作。迁移保留历史文件；显式删除移除选中的 Session。

**保留读取触发的发布及其写锁。** 否决，因为观察历史 Session 不得写入后继代际，也不得竞争写入所有权。

## Consequences

永久删除可与惰性迁移共存，普通读取不会变成破坏性操作。写入竞争会拒绝删除，避免部分移除活动日志。空 POSIX 锁目录会保留，删除没有自动保留计划。
