# @deepseek-ai/dsh-skill-settings

[English](README.md) | 中文

基于 [`@deepseek-ai/dsh-skill`](../skill) 注册表的用户级 skill 启用覆盖。

该插件通过可选设置缝注册 `skills` 设置命名空间（`{ disabled: string[] }`），并把它推入注册表的调用策略覆盖槽位。禁用是彻底的：被列出的 skill 既不能由模型也不能由用户调用，因此模型目录、`skill` 工具、`/name` 手势和配置列表保持一致。变更在下一次注册表读取时即生效，无需清除发现缓存；隔离失败的 `skills/change` 广播会通知持有目录的消费方重新拉取。

需要 `ctx.skills`（`inject: ['skills']`）；设置接线是可选的，仅当设置服务存在时挂载。

## 设置命名空间：`skills`

| 字段 | 默认值 | 含义 |
|---|---|---|
| `disabled` | `[]` | 用户关闭的 kebab-case skill 名称。不是合法 skill 名称的条目会拒绝写入。 |

`applies: live` —— 提交的变更在下一次目录读取时对所有消费方可见，模型会在下一个 pre-step 收到替换目录。

## 模型体验

通过 `dsh-tool-skill` 与用户显式调用消费方读取的注册表覆盖间接生效。

#### KV Cache 影响

禁用后，下一个 pre-step 会在可复用前缀之后追加替换目录；此前的 token 不受影响。

## 已知限制与暂缓事项

- **覆盖按名称全局生效**：其他项目或 scope 中的同名 skill 也会被禁用；覆盖不支持按工作区或按 preset。
- **仅在存在设置服务时注册命名空间**：没有设置服务时不存在覆盖，目录行为与组合配置完全一致。
