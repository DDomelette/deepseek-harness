# Agent Note: 模块引用与 Cordis 产品标识符

Status: implemented

[English](2026-10-25-rescope-preserves-product-identifiers.md) | 中文

## 问题

`cordis` preset id、Client 语言命名空间和 `cordis/*` 事件键都是已注册的产品数据。改变其拼写会改变预设选择、翻译查找或生产者与消费者的对应关系。框架包拥有独立的发布名 `@deepseek-ai/cordis`。

## 决策

[作用域改名脚本](../../../../scripts/rescope-vendor.ts) 通过精确到文件与 vendor 名字的条目保留产品 token。同一文件中的显式模块选择器仍遵循包名映射：import、声明合并、模块解析与模块 mock。正向与反向改名均保留产品值。

原始包名验收输入属于[改名脚本 fixture](../../../../scripts/rescope-vendor.spec.ts)。仓库扫描只排除这一份 fixture 文件，使这些输入保留原始名字。

## 考虑过的替代方案

- 改写每个加引号的 `cordis` token：会改变已注册的产品数据，并可能损坏事件名或持久化的预设选择。
- 排除产品标识符所属文件中的所有 token：会让真实包 import 无法解析，也阻止这些 import 的反向改名。

## 后果

新的产品 id 位置需要精确到文件与名字、经过审查的条目。其他名字与未列出的文件继续遵循普通改名规则。文件例外不会让模块 import 脱离包名映射。

原始发布理由记载于[已归档的决策](../../archived/process/2026-08-10-vendor-package-rescope.md)。[当前映射](../../../../docs/rescope.zh.md)拥有发布名字；本记录拥有包引用与产品标识符的区分规则。
