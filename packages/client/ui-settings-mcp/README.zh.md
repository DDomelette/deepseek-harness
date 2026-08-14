# @deepseek-ai/dsh-client-ui-settings-mcp

[English](README.md) | 中文

Web 设置「插件」分区的 **MCP** 标签页。浏览器插件注册一个本地化的 `settings.plugins.tab` 贡献，id 为 `mcp`（order 5，位于插件配置与插件列表之间）；「插件」分区拥有导航入口与标签栏。选中该标签页时，通过 [`api-remotes`](../../api/remotes/README.md) 懒调用 `ctx.remote.mcpServers.list()`，并通过 `ctx.settingsScope` 绑定 `mcp-servers` 设置命名空间（见 [`ui-settings`](../ui-settings/README.md)）。

该标签页以可搜索的列表展示 Host 端 [`mcp-manager`](../../mcp/mcp-manager/README.md) 上报的全部 MCP 服务器。settings 管理的行带有启停开关，只通过深层路径 op 写 `enabled` 这一个叶子；随后重新读取列表，因为挂载生命周期是异步结算的。已启用的 settings 行以彩色圆点报告挂载生命周期（`connecting` / `ready` / `failed`），启动失败的行在标题下方展示失败摘要；挂载完成并不等于已验证的存活连接，文案不会如此声称。声明式行（在 cordis.yml 中声明的服务器）只读：展示「由配置文件管理」徽标与启停标签，其开关与齿轮保持禁用。

圆角方形「+」按钮打开添加表单：名称、传输方式选择器、对应传输的字段（stdio 的命令/参数/环境变量/工作目录，或 http 的 URL/请求头），以及单次调用超时。校验随每次输入即时进行——serverName 模式、与现存名单的重名、缺失端点、超时、KEY=VALUE 行格式——草稿无效时保存按钮保持禁用。参数按行与逗号拆分；环境变量与请求头按 KEY=VALUE 行解析，并通过一次整条目写入保存，表单里刚输入的 secret 随之落盘。

齿轮打开行内编辑器，预填脱敏条目。非 secret 字段显示当前值；env/headers 始终以留空开头并带「保持不变」提示，只有用户改动的字段才会以逐字段深层路径 op 提交——留空的 secret 字段绝不重写已存 secret。删除需要行内确认，随后清除整个条目。

加载、空列表、无匹配与通用失败状态只属于已挂载组件；读取失败后可重试，且不会暴露传输细节。注册使用 `ctx.slots.inject()`，因此无需 import 分区拥有方即可跟随标签页的延迟声明、重新声明、本地化变化与卸载。

## 模型体验

无，因为本包只在浏览器设置中可视化并编辑 Host 拥有的服务器名单，不注册任何面向模型的内容。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **快照驱动的名单** — 标签页不订阅名单变化；仅在自身写入后与重试时重新读取，并在重新挂载时获取新快照。
- **不支持清空 secret** — env/headers 留空表示保持已存值；清空它们需要删除并重新添加该服务器。
- **不支持改名** — serverName 即 settings 键；改名等于删除加新增。
