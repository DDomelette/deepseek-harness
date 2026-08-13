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

## Declarative 投影

`declarativeMcpServers(ctx)` 投影挂载 `dsh-mcp-client` 的 Loader 条目：serverName 和 transport 从条目配置读取，启用状态来自 Loader，并携带根 Fiber 相位。面板将它们以只读方式与设置管理的名册并排渲染；它们的生命周期始终由 `cordis.yml` 拥有。

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

- **写入尚不会热挂载服务器**：命名空间会注册并校验，但按启用条目各挂载一个 `dsh-mcp-client` 实例的 supervisor 属于独立任务；在此之前该段只是惰性配置。
