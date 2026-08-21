# telemetry/：本地用量观测

[English](README.md) | 中文

此组负责本地、由提供方报告的用量观测；它不进入持久化会话日志，也不参与模型请求组装。

## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`usage-telemetry/`](usage-telemetry/README.zh.md) | 为每次带会话归属且报告提供方用量的 `llm/stream` 调用捕获一条 v1 JSONL 行。 | — |

`usage-telemetry` 是独立的本地监控器，而非 `SessionTelemetryBackend`：会话遥测后端投递会话活动，此组则为外部消耗监控记录提供方用量。[replay token meter](../../.agents/notes/implemented/architecture/2026-07-15-replay-token-meter-service.zh.md) 另行折叠持久化会话事件以估算请求压力，既不读取也不接收本地 JSONL 行。
