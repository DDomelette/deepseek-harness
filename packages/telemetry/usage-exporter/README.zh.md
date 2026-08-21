# @deepseek-ai/dsh-usage-exporter

[English](README.md) | 中文

可选 Host 插件：tail [`@deepseek-ai/dsh-usage-telemetry`](../usage-telemetry/README.zh.md) 写出的本地 usage JSONL，并把确定性 batch 推送到 DeepSeek Monitor 的接收端点。随附 Web 组合以**禁用**状态挂载它；本地文件捕获仍是事实来源，Monitor 的文件扫描器继续可用于回填。

## 用法

在 profile patch 中启用并配置 endpoint：

```yaml
- id: usage-exporter
  name: '@deepseek-ai/dsh-usage-exporter'
  config:
    endpoint: http://127.0.0.1:29351/api/v1/dsh/usage
    token: '<ingest-token>'
    sourceId: my-laptop
```

插件以 offset 游标 tail `$DSH_HOME/telemetry/usage-YYYY-MM-DD.jsonl`，游标位于 `$DSH_HOME/storages/usage-exporter.json`。batch 使用确定性 `batchId`，重试复用同一 id；只有确认、重复、永久拒绝或放弃后才会推进游标。

## 模型体验

### Usage 推送

#### 模型看到什么

没有提示词、消息、工具 schema、工具结果或模型调用变更。插件 tail 现有 `usage-*.jsonl` 文件，只通过 `POST /api/v1/dsh/usage` 发送行。

#### Token 影响

无直接 token 影响。

#### KV Cache 影响

无直接影响；该插件不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **首次启用从当前 EOF 开始** — 历史数据仍由 Monitor 文件扫描器回填；`startFrom: 'beginning'` 是显式覆盖。
- **每个 DSH home 单进程** — 游标假设一个遥测根只属于一个 exporter，与捕获写入器的单实例假设一致。
- **永久 4xx 拒绝会推进游标** — 被拒绝的行留在本地 JSONL 中用于手动回填，push 不会无限重试。
- **重试之外没有积压队列** — 端点停机时间超过单个重试窗口时，期间的行会从 push 放弃并继续留在本地文件。
