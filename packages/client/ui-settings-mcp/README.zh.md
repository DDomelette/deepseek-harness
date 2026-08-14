# @deepseek-ai/dsh-client-ui-settings-mcp

[English](README.md) | 中文

Web 设置「插件」分区的 **MCP** 标签页。浏览器插件注册一个 id 为 `mcp` 的本地化 `settings.plugins.tab` 贡献（order 5，位于插件配置与插件列表之间）；「插件」分区拥有导航入口与标签栏。选中该标签页时，通过 [`api-remotes`](../../api/remotes/README.md) 懒调用 `ctx.remote.mcpServers.list()`，并通过 `ctx.settingsScope` 绑定 `mcp-servers` 设置命名空间（见 [`ui-settings`](../ui-settings/README.md)）。

该标签页以可搜索的列表展示 Host 端 [`mcp-manager`](../../mcp/mcp-manager/README.md) 上报的全部 MCP 服务器。settings 管理的行带有启停开关，通过 settings scope 写入——写入会在 scope 快照当前条目上合并，因此标签页未渲染的字段保持原样——随后重新读取列表，因为挂载生命周期是异步应答的。已启用的 settings 行以彩色圆点表示挂载生命周期（`connecting` / `ready` / `failed`），启动失败的行在标题下方展示失败摘要；挂载完成并不等于连接可用，文案也不会如此声称。声明式行（在 cordis.yml 中声明的服务器）是只读的：展示「由配置文件管理」徽标与启停标签，其开关与齿轮保持禁用。圆角方形「+」按钮切换到添加视图，在添加表单落地前，该视图仅为含标题与返回链接的占位。

加载、空列表、无匹配结果与通用失败状态只属于已挂载组件；读取失败后可重试，且不会暴露传输细节。注册使用 `ctx.slots.inject()`，因此能跟随标签 slot 的延迟声明、重新声明、本地化变化与 teardown，而无需 import 分区拥有方。

## 模型体验

无，因为本包只在浏览器设置中展示与编辑 Host 拥有的服务器列表，不注册任何模型接口。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **快照驱动的列表** —— 标签页不订阅列表变化；仅在自身写入后与重试时重新读取，并在重新挂载时获取新快照。
- **启停写入基于脱敏视图合并** —— `SettingsScope.set(serverName, value)` 整字段覆盖 `[serverName]` 路径，而 scope 快照可能不含 secret 角色字段（`env`/`headers`）；基于快照构建的合并值会因此清空已存机密。明确的保密写入路径（由 wire 的 secret 位表驱动的细粒度 path-op）暂缓到编辑任务。
- **占位添加视图与禁用齿轮** —— 添加表单与行内编辑视图属于后续任务；齿轮暂以禁用形态发布。
