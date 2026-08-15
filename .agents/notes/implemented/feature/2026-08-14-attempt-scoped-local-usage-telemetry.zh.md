# Agent Note: 按尝试归属的本地 token 用量遥测

Status: implemented

[English](2026-08-14-attempt-scoped-local-usage-telemetry.md) | 中文

## 问题

DeepSeek Monitor 需要一份不含会话内容的精简本地记录，用于接收提供方报告的 token 用量。已完成的 `assistant/message` 不是正确的观测点：失败或中止的尝试可能报告可计费用量却不产生该事件，重试会折叠到成功的 assistant 消息中，而直接发起的压缩或会话标题调用会绕过 agent loop 的 assistant-message 路径。

磁盘上的 v1 JSONL 行已冻结，且没有结果、尝试或用途字段。只记录成功调用会让其字段暗含不真实的完整性保证。发射器还需要正确处理 settings 重载和资源释放，不能保留请求状态，也不能在 Cordis fiber 释放后留下仍在运行的文件写入。

## 决定

`usage-telemetry` 包装提供方无关的 `llm/stream` waterfall。它原样传递每个分片，记住最后观测到的提供方 usage 分片，并在调用具有 `GenerateOptions.sessionId` 时于 `finally` 入队一条行。带会话归属且产生 usage 的调用会记录一条行，即使它随后出错、被重试，或其消费方中止或返回。没有 usage 或 session id 的调用不产生行。

行在 usage 分片到达时记录 `time`，从 `GenerateOptions.model` 记录 `model`，并从实时会话 header 读取可选 `cwd`。该包没有 `session/event` 监听器、请求 header 路径或请求状态缓存，因此成功请求不存在第二条捕获路径。

v1 行包含 `v`、`time`、`sessionId`、可选 `cwd`、可选 `model` 和四个输入/输出/cache token 桶。缺失的 cache 桶为零。它不推断结果或用途。包 README 负责面向消费者的行 schema 和本地文件行为。

标准 `usage-telemetry` settings 区段控制监听器。settings 提供方连接时覆盖组合值；脱离后，来源回退到组合配置项。流在结束时会将文件写入入队，但不会等待写入完成。写入器会排序服务实例发出的追加，在前一项被拒绝后继续，且正常资源释放会 drain 已开始的写入。多个进程共享一个 Harness home 不受支持，硬崩溃可能丢失未完成的写入，资源释放开始后才完成的调用会被省略。

## 与 replay token 计量的分工

[replay token meter](../architecture/2026-07-15-replay-token-meter-service.md) 折叠持久化会话事件以估算当前模型可见请求，并且仅在请求信封仍匹配时复用成功调用的 usage 锚点。本地 usage telemetry 为外部消耗监控记录每次实时、带会话归属的模型调用的提供方 usage。它既不馈送也不回放 token meter，token meter 也不读取遥测文件。这种分离保持计量器的单次折叠记账，且不引入重复计数关系。

## 考虑过的替代方案

**继续观测 `session/event`。** 不采用，因为持久化 assistant 消息表示已完成且组装的响应，而不是每次提供方尝试或直接模型调用。从该事件流重建尝试仍会遗漏可计费的失败工作和辅助调用。

**只在成功的终止分片之后写入。** 不采用，因为提供方 usage 分片到达时，用量已是消耗事实。因错误、中止或重试而丢弃它会系统性少计，同时没有字段标识被排除的用量。

**在 v2 行中增加结果、尝试和用途。** 不采用，因为当前监控方没有消费这些维度的需求，冻结的 v1 字段可在不迁移消费者的情况下如实表示按尝试归属的用量。未来 v2 需要作出与消费者协调的决定。

**从 replay token meter 推导外部消耗。** 不采用，因为计量器根据持久化会话状态估算当前上下文压力，并有意只锚定匹配的成功调用。它无法恢复没有对应持久化 assistant 消息的失败尝试或直接调用。

## 验证

单元覆盖验证成功、失败、重试、直接调用、缺失会话、缺失 usage、禁用、settings 脱离、usage 后中止、写入失败、串行写入和资源释放 drain 行为。Loader 组合测试启动 LLM、session 和 usage-telemetry 插件并观测 JSONL 输出。无密钥 replay 快照通过隔离的 Harness home 运行随附 profile，在不改变模型 transcript 的情况下固定 usage 产物。

## 后果

消费者获得的是每次合格提供方尝试的一条不含结果信息的用量事实，而非完成记录。没有 session id 的调用会被刻意排除。本地日期文件名可能与北京时间聚合日不同，因此行 `time` 仍是依据。该包避免导出会话内容和变更持久化日志，代价是没有跨进程追加保证，也没有崩溃时写入恢复。
