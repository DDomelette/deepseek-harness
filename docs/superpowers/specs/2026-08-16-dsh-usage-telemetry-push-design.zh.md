# DSH Usage 遥测设置开关与主动推送 Exporter — 设计

日期：2026-08-16
状态：草稿，待评审

## 1. 背景

`@deepseek-ai/dsh-usage-telemetry` 已经把每次带 session 归属的实时
`llm/stream` 调用捕获为冻结的 v1 JSONL 行，写入
`$DSH_HOME/telemetry/usage-YYYY-MM-DD.jsonl`。DeepSeek Monitor 目前通过轮询
读取该文件（即 `localLog` 通道）。

还缺两块：

1. **A — Web 端没有开关。** `usage-telemetry` settings 区段已存在且可热生效，
   但它不在 `WEB_SETTINGS_NAMESPACES` 白名单中，Web 设置界面无法开关本地记录。
2. **B — 没有主动推送通道。** 多端、远程和实时看板读不到另一台机器上的本地
   文件。需要一个默认禁用的 exporter 插件，让每个 DSH 实例把本地行推送到
   同一个接收入口。

对应的 DeepSeek Monitor 交接契约定义了 `POST /api/v1/dsh/usage` 与 batch
幂等语义。

## 2. 目标与非目标

目标：

- 本地 JSONL 捕获继续作为持久化的事实来源；
- 给本地捕获增加 Web 设置开关（A）；
- 新增默认禁用的 `usage-exporter` 插件，tail 本地 JSONL 并批量 HTTP 推送（B）；
- exporter 与捕获核心、具体看板完全解耦；TokenMonitor 只是第一个端点实现。

非目标：

- 改动冻结的 v1 行格式；
- 用 push 取代本地文件捕获；
- 做通用多租户看板后端；
- TokenMonitor 反向给 DSH 下发配置。

## 3. Part A — 本地捕获的 Web 开关

### Host 改动

- `packages/host/apiproxy/src/api-proxy.ts`：把
  `USAGE_TELEMETRY_SETTINGS_NAMESPACE` 加入 `WEB_SETTINGS_NAMESPACES`。
  `dsh-usage-telemetry` 的区段注册和热生效逻辑已经存在，保持不变。
- 增加 apiproxy 测试：`settings.describe` 暴露 `usage-telemetry`，且通过代理
  的写入能到达服务。

### Client 改动

- `packages/client/ui-settings-plugins`：新增 `UsageTelemetryCard`，贡献到现有
  `settings.plugin.item` slot，沿用 Bash/AgentLoop/WebSearch 卡片模式。
- 卡片通过 `ctx.settingsScope.bind({ namespace: 'usage-telemetry' })` 读取状态，
  渲染一个 `enabled` 开关，且只通过 `setPath` 写 `enabled` 叶子。
- 文案中英双语；卡片注明 DeepSeek Monitor 等外部工具读取本地遥测文件。

### 测试

- 新卡片的插件注册测试；
- 卡片读取/写入/开关行为测试；
- 更新 Plugins 设置 aria golden（新增一张卡片）。

## 4. Part B — 主动推送 exporter 插件

### 包

新 host 包 `@deepseek-ai/dsh-usage-exporter`，位于
`packages/telemetry/usage-exporter`。

该包只提供普通 Cordis 插件模块，遵循其他功能包的约定。随附 Web bundle 中
以**禁用**条目挂载：

```yaml
- id: usage-exporter
  name: '@deepseek-ai/dsh-usage-exporter'
  disabled: true
```

部署方移除 `disabled: true` 并提供 endpoint 后即选择启用。

### 为什么 tail JSONL，而不是新增内存事件

exporter 有意**不**订阅 usage-telemetry 的新内存事件：

- 本地 JSONL 已经是有序、持久的事实来源；
- offset 游标天然支持重启续传，也给出清晰的历史回填边界；
- exporter 可独立启用、禁用、升级、热更新，不碰捕获核心；
- 行解析校验可以直接复用 `dsh-usage-telemetry` 的 schema。

这样 Part B 是纯增量插件，捕获侧零改动。

### Config

Schemastery `Config`：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `endpoint` | string | — | 绝对 `https?://` URL，必填 |
| `token` | string | `''` | `role('secret')`；以 `Authorization: Bearer <token>` 发送 |
| `sourceId` | string | 自动 | `[A-Za-z0-9._-]{1,64}`；默认由 hostname + DSH home 哈希派生 |
| `pollIntervalMs` | number | 1000 | tail 轮询间隔 |
| `maxBatchRows` | number | 200 | 1–1000 |
| `maxBatchBytes` | number | 262144 | 请求体上限；服务端契约同时封顶 1 MiB |
| `requestTimeoutMs` | number | 10000 | 单次 HTTP 超时 |
| `maxAttempts` | number | 5 | 瞬时失败重试次数 |
| `baseRetryMs` | number | 1000 | 指数退避基数 |
| `maxRetryMs` | number | 30000 | 退避上限 |
| `heartbeatIntervalMs` | number | 60000 | 租约心跳间隔；部署时必须满足 TokenMonitor 侧 `pushLeaseMs > 3 × heartbeatIntervalMs`（默认 10min > 3×60s） |
| `startFrom` | `'end' \| 'beginning'` | `'end'` | 首次启用从当前 EOF 开始 tail；`beginning` 为显式回填 |

### 数据流

```text
usage-telemetry ──append──> usage-*.jsonl
                                 │
usage-exporter ──poll+tail───────┘
  │ parse and validate each line (v1 row schema)
  │ accumulate rows into a batch
  │ build batchId = sha256(sourceId, file identity, [startOffset, endOffset))
  │ 从实际生效的遥测根目录派生 rootId
  │ 心跳定时器:每 heartbeatIntervalMs 发送 { sourceId, rootId, heartbeat: true }
  ▼
POST {endpoint}
  Authorization: Bearer <token>
  { sourceId, rootId, batchId, sentAt, rows }
  │
  ├─ 2xx / duplicate-batch ──> 持久化游标,越过该 batch
  ├─ 429/5xx/网络 ─────────────> 用同一个 batchId 退避重试,最多 maxAttempts 次
  ├─ 重试耗尽 ─────────────────> 判定为 abandoned,记日志并推进游标(本地文件仍是事实来源)
  └─ 400/401/413 permanent ───> log, advance cursor (local file remains source of truth)
```

### 游标持久化

- 游标文件：`$DSH_HOME/storages/usage-exporter.json`。
- 每个 endpoint/source 组合一条记录：`{ file, offset, mtimeMs }`，覆盖当前正在
  tail 的遥测文件。
- 只有服务端确认 batch（或判定为永久拒绝）后才推进游标。
- 原子写入（临时文件 + rename），符合仓库小型持久状态约定。
- 启动时清理已删除遥测文件的旧游标。

### batch 身份与重试

- `batchId` 由 `(sourceId, 文件身份, startOffset, endOffset)` 确定性派生，
  重试复用同一 id。
- 重试不重新切分行：相同字节区间始终形成相同 batch。
- 重启后从最后确认的游标继续；未确认的行在下一轮 poll 后重试。
- 重试窗口以单次 poll 周期内的 `maxAttempts` 为界：耗尽后 batch 判定为
  abandoned 并推进游标，后续行继续流动；被放弃的行仍留在本地 JSONL 中，
  可交给文件扫描兜底。因此 Monitor 的 batch 注册表 TTL 只需覆盖这个有界
  重试窗口。
- Monitor 侧幂等键是 `(sourceId, batchId)`，**不用行内容指纹**，因此不同
  batch 中字节完全相同的合法行不会被合并漏计。

### 错误处理

| 失败 | exporter 行为 |
|---|---|
| 本地畸形行 | 记一次日志，跳过该行，推进 offset |
| 401 | 记录 `usage-exporter: ingestion unauthorized`，退避到 `maxRetryMs`，保留游标 |
| 400/413 | 记永久拒绝，推进游标，避免一个毒 batch 卡死队列 |
| 429/5xx/网络 | 最多 `maxAttempts` 次指数退避；仍失败则判定为 abandoned、记日志并推进游标，让后续行继续流动 |
| 服务端重复 batch | 视为成功并推进游标 |
| 资源释放 | 停止轮询，等待在途请求，持久化最后确认的游标 |

### 安全与隐私

- token 为 `role('secret')`，永不写日志；
- 除回环地址（`http://127.0.0.1`、`http://localhost`）外，endpoint 必须使用
  `https`，兼顾本地 TokenMonitor 的便利；
- 行中可能包含 `cwd`，因此 endpoint 视为受信接收端；未来可增加远程 endpoint
  的 `cwd` 脱敏选项；
- 除 v1 行和信封元数据外，不发送任何新字段。

### `rootId` 与心跳

- `rootId = 'root:' + sha256(UTF-8(规范化遥测根路径))`。
- exporter 的规范化输入是**实际生效的遥测根目录**：配置了
  `telemetryRoot` 就用它，否则用
  `path.resolve(join(resolveDshHome(), 'telemetry'))`。Windows 上把
  `\` 替换为 `/` 并整串 `toLowerCase()`；非 Windows 保持原串。
- TokenMonitor 对 `resolveTelemetryRoot(store, env)` 的结果执行同一规范化，
  因此原生路径空间下两边结果可比较相等。
- 跨命名空间根（WSL `/home/...` 与 Windows `\\wsl.localhost\...`）在 v1
  中刻意不自动匹配；需要时在 Monitor 侧显式设置 `collectionMode = push`。
- exporter 每 `heartbeatIntervalMs` 发送一次
  `{ sourceId, rootId, heartbeat: true }`（不带 `batchId` 和 `rows`），
  空闲期也持续续租，避免 Monitor 的 `auto` 模式因租约到期重新开启文件轮询
  导致重复计数。

## 5. 与 TokenMonitor 的交互

Monitor 交接文档（`2026-08-16-dsh-usage-ingest-handoff.md`，已交付到
TokenMonitor 仓库）定义：

- `POST /api/v1/dsh/usage`，携带 `sourceId`、`rootId`、`batchId`、`sentAt` 与 v1 rows；另有续租心跳形态；
- 以 `(sourceId, batchId)` 为幂等键，带 TTL；
- 与现有文件扫描器相同的行 → `UsageRecord` 映射；
- 某遥测根目录进入 push 模式后，停止日常 `localLog` 轮询，但保留手动回填。

exporter 的 `startFrom: 'end'` 默认让启用前的历史继续由文件扫描器负责，
因此 push 与文件扫描不会重复计数。

## 6. 测试

- `dsh-usage-telemetry`：namespace 暴露测试放在 apiproxy 测试中。
- `dsh-usage-exporter` 单元测试：
  - config schema/默认值与 endpoint/token 校验；
  - JSONL tail、游标推进与重启续传；
  - batch 组装与确定性 `batchId`；
  - 各 HTTP 结果的重试/退避分类；
  - 畸形行跳过与永久拒绝推进；
  - 游标文件原子写/清理；
  - 资源释放等待在途请求。
- Loader 组合测试：
  - 随附 Web 组合默认保持该条目禁用；
  - overlay 启用后指向本地 HTTP fixture，能收到 batch，重启不丢行。
- Web e2e：
  - 新 Usage Telemetry 卡片渲染，并把 `enabled: false` 写穿到
    `$DSH_HOME/settings.yaml`。

## 7. 上线顺序

1. 实现 A，随附 Web 开关启用；
2. 实现 B，在 Web bundle 中作为禁用条目存在；
3. 在 Monitor 仓库合入 ingest endpoint；
4. 两侧落地后，本地启用 exporter 行并配置 `endpoint`/`token`；文件扫描仍保留
   用于回填和未安装 exporter 的 DSH 实例。

## 8. 待定决策

- `sourceId` 的精确默认派生方式（当前建议 hostname + DSH home 短哈希）；
- 非回环 endpoint 是否默认发送 `cwd`（当前建议发送；远程部署应使用 HTTPS 和
  受信接收端）。
