# @deepseek-ai/dsh-mcp-manager

[English](README.md) | 中文

由设置驱动的 MCP 服务器管理器：拥有 Web 设置面板编辑的 `mcp-servers` 用户设置命名空间，并将 `cordis.yml` 中声明的（declarative）MCP 服务器以只读方式投影在面板管理的名册旁边。

## 用法

与 settings 提供方和 Loader 一起挂载该插件；它注入 `settings` 和 `loader`：

```yaml
- name: '@deepseek-ai/dsh-mcp-manager'
```

注册后的 `mcp-servers` 段是一个以 serverName 为键的字典；每个条目镜像 `dsh-mcp-client` 的 Config 字段并增加 `enabled`。写入即时生效。当键违反 serverName 模式（`[A-Za-z0-9_-]{1,32}`）或与 `cordis.yml` 中已声明的服务器重名时，写入会被拒绝——declarative 名册与面板管理名册绝不重叠。

## 配置

`mcp-servers` 段位于设置文档中（是一个命名空间，而非插件 Config）：

| 字段 | 传输 | 必填 | 描述 |
|---|---|---|---|
| （键） | 两者 | 是 | serverName：`[A-Za-z0-9_-]{1,32}`，在面板管理名册与所有 declarative 服务器中唯一 |
| `enabled` | 两者 | 否 | 该条目是否生效（默认 `true`） |
| `transport` | 两者 | 是 | `"stdio"` 或 `"streamable-http"` |
| `command` | stdio | 是 | 要 spawn 的可执行文件 |
| `args` | stdio | 否 | 传给命令的参数（默认 `[]`） |
| `env` | stdio | 否 | 额外环境变量；带 `role('secret')`，在任何脱敏 `describe()` 中都会被隐藏 |
| `cwd` | stdio | 否 | 子进程工作目录（默认 `''`） |
| `url` | http | 是 | MCP 服务器 URL |
| `headers` | http | 否 | 额外标头；带 `role('secret')` |
| `toolCallTimeoutMs` | 两者 | 否 | 每次 `callTool` 调用的超时（默认 60000） |
| `failOnStartupError` | 两者 | 否 | 将初始连接或工具同步失败视为该条目的致命错误（默认 `false`） |
| `reconnect.enabled` | 两者 | 否 | 连接丢失后是否启动自动重连（默认 `true`） |
| `reconnect.initialDelayMs` | 两者 | 否 | 首次重连尝试前的延迟（默认 500） |
| `reconnect.maxDelayMs` | 两者 | 否 | 指数退避的最大延迟（默认 30000） |
| `reconnect.maxAttempts` | 两者 | 否 | 停止前的最大重连尝试次数（默认 10） |

## Declarative 投影

`declarativeMcpServers(ctx)` 投影挂载 `dsh-mcp-client` 的 Loader 条目：serverName 和 transport 从条目配置读取，启用状态来自 Loader，并携带根 Fiber 相位。面板将它们以只读方式与设置管理的名册并排渲染；它们的生命周期始终由 `cordis.yml` 拥有。

## 名册 Remote

本包的默认导出是 `McpServersGateway`，即 Loader 为 `@deepseek-ai/dsh-mcp-manager` 条目挂载的插件：它拥有命名空间注册与 supervisor，并暴露带唯一 `list()` 方法的 `mcpServers` Remote。每次调用都重新读取两个平面，先返回 settings 行，再返回 declarative 行：serverName、transport、source、`enabled`，以及挂载 `status`（`connecting`/`ready`/`failed`，失败时附 `error`）。`status` 仅表示挂载生命周期——`ready` 表示 mcp-client fiber 已落定，绝不表示服务器已应答；disabled 的 settings 行与 declarative 行报告 `null`。机密配置字段（`env`、`headers`）从不投影；agent preset 内联挂载的 MCP 服务器按设计不在其中——它们从不出现在 `ctx.loader.entries()` 中。设置名单或挂载生命周期状态变化后，管理器会发出不带载荷的 `mcp-servers/change` 失效通知；Remote 消费端重新读取 `list()`，而不把事件本身当作快照。

## 与 dsh-mcp-client 的关系

`dsh-mcp-client` 每个插件实例连接一个 MCP 服务器，并把它的工具注册到 `ctx.tools`。本包拥有面板写入的设置命名空间，自身从不连接任何服务器——每个生效条目都是一个 `dsh-mcp-client` 实例。

## 模型体验

### 受管理的 MCP 服务器工具

#### 模型看到的内容

本包不注册任何自己的提示词、工具或结果；模型看到的内容与每个已挂载的 `dsh-mcp-client` 实例为启用的 `mcp-servers` 条目在 `mcp__<serverName>__<rawName>` 下注册的内容完全相同。

#### Token 影响

自身没有 token 成本；每个已挂载服务器的工具定义成本与 `dsh-mcp-client` 文档中按服务器描述的相同。

#### KV Cache 影响

自身没有 KV-cache 影响；新增、移除或切换条目对已挂载工具集的改变，与编辑等价的 `cordis.yml` 条目完全相同。

## 已知限制与暂缓事项

- **仅生命周期状态** — `status` 上报挂载 fiber 的结算，而非存活状态；在默认 `failOnStartupError: false` 下，一台始终不应答初始连接的服务器仍会报告 `ready`。
- **预设挂载的服务器不可见** — agent preset 内联挂载的 MCP 服务器不在 `ctx.loader.entries()` 中，因此也不在声明式名单里。
- **以 serverName 为键** — 改名意味着删除条目并新增；settings 键即名称。
- **面板是唯一编辑器** — 该分节是普通 settings 数据，无头部署可直接编辑 `settings.yaml`，但针对声明式名称的写时重名守卫只经 settings 缝生效。
