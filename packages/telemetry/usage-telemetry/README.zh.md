# @deepseek-ai/dsh-usage-telemetry

[English](README.md) | 中文

此包进行按尝试归属的本地提供方用量捕获。该插件观测实时 `llm/stream` 调用，且仅当调用同时具备 `sessionId` 和提供方 usage 分片时追加一条不含结果信息的 v1 JSONL 行。

## 配置与组合

`enabled` 控制服务是否订阅 `llm/stream`。随附的 Web 组合启用该包；部署可以替换该 Cordis 配置项，或设置标准的 `usage-telemetry` settings 区段。生成的[配置目录](../../../docs/config-catalog.md)列出了经验证的配置。

```yaml
- id: usage-telemetry
  name: '@deepseek-ai/dsh-usage-telemetry'
  config:
    enabled: true
```

settings 提供方处于连接状态时覆盖组合值。它脱离后，服务回退到组合值。`enabled` 状态变化只会添加或移除 `llm/stream` 监听器。

## v1 JSONL 行

一条行记录一次带会话归属且产生提供方 usage 的 `llm/stream` 调用，包括之后出错、重试，或消费方中止或返回的调用。没有 `sessionId` 或提供方 usage 的调用不生成行。v1 没有结果、状态、尝试或用途字段。

```json
{"v":1,"time":1786780800123,"sessionId":"sess_123","cwd":"D:\\Deepseek_Harness","model":"deepseek-chat","inputTokens":120,"outputTokens":48,"cacheReadTokens":32,"cacheWriteTokens":0}
```

| 字段 | 含义 |
|---|---|
| `v` | 冻结的行 schema 版本：`1`。未知版本不是有效的 v1 输入。 |
| `time` | 提供方 usage 分片到达时记录的 Unix 毫秒。这是聚合依据。 |
| `sessionId` | 模型调用归属的会话。 |
| `cwd` | 来自实时会话 header 的可选当前工作目录；不可用时省略。 |
| `model` | 来自 `GenerateOptions.model` 的可选值。 |
| `inputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens` | 提供方报告的 token 桶。缺失的 cache 桶写为零。 |

## 数据与生命周期

行追加到 `$DSH_HOME/telemetry/usage-YYYY-MM-DD.jsonl`。文件名使用主机本地日历日期，因此可能与 DeepSeek Monitor 的北京时间聚合日不同；消费者按每行的 `time` 聚合，而不是按文件名。

流在结束时会序列化行并将写入入队，但不会等待文件 I/O。服务实例会串行执行自身的追加，某次追加被拒绝不会阻塞后续行，写入失败会被记录且不改变模型流。服务正常 dispose 时会 drain 已开始的写入。硬进程崩溃可能丢失未完成的写入。

包装层在服务资源释放开始后才结束的调用不会被记录。

## Replay token meter

[replay token meter](../../../.agents/notes/implemented/architecture/2026-07-15-replay-token-meter-service.md) 折叠持久化分片和会话事件以估算请求压力。它既不读取本地 usage JSONL，也不接收遥测行；usage telemetry 同样不读取或改变 replay token meter。因此，两种机制不会引入重复计数关系。

## Model Experience

### 本地用量捕获

#### What the model sees

不改变 prompt、消息、工具 schema、工具结果或模型调用。服务观测已发出的 `llm/stream` 调用，并且只写入本地 JSONL。

#### Token effect

没有直接 token 影响。

#### KV Cache effect

没有直接影响；观测流不会改变任何请求前缀。

## Known Limitations and Deferred Work

- **捕获仅限会话范围** — 没有 `sessionId` 的调用会被刻意排除，即使它报告了提供方 usage。
- **v1 不含结果信息** — 即使调用之后失败、重试或中止，也会写入该调用最后观测到的 usage 分片；行不标识结果、尝试或用途。
- **`cwd` 尽力而为** — 实时会话或其 header 值不可用时省略该字段。
- **文件日期为本地日期** — 文件名可能与北京时间聚合日不同；行 `time` 仍是依据。
- **共享 `DSH_HOME` 只支持单进程** — 多个进程可能交错追加 JSONL，因而不受支持。
- **正常释放不同于崩溃** — dispose 会 drain 已开始的写入，硬进程崩溃可能丢失未完成的写入。
- **省略延迟完成的包装层** — 在资源释放开始后才完成的调用不会被记录。
