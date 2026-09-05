---
description: "本地服务商用量记录与可选 HTTP 发送。"
kind: "package-group"
---

# telemetry/ — 服务商用量

[English](README.md) | 中文

## 概述

在本地记录服务商报告的令牌用量，并可选地将记录发送到 HTTP 端点。用量采集独立于[会话遥测子系统](../../docs/subsystems/session-telemetry.zh.md)的规范会话事件上报。

## 目录

- [包](#packages)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

- [usage-telemetry](usage-telemetry/README.zh.md) 按服务商请求尝试记录用量；基础组合启用记录。
- [usage-exporter](usage-exporter/README.zh.md) 负责发送及持久化游标；分发条目默认禁用。

<a id="dev-note"></a>
### 开发备注

无。
