# @deepseek-ai/dsh-client-ui-settings-skills

[English](README.md) | 中文

Web GUI 的「技能」设置页：每个展示分组一个图标，点进分组后是技能列表，每个技能一个开关。

分组按 skill 声明的 `group` frontmatter 聚合当前会话的 `skill.catalog` 投影，未声明时回退到发现来源（已知来源使用本地化标签）。仅当目录与设置修订的禁用标记一致时，页面才接受二者；并发变更后会重读一次。开关会保留当前目录外已禁用的名称，并通过带修订保护的设置线路写入完整列表。宿主的 [`@deepseek-ai/dsh-skill-settings`](../../skill/skill-settings) 覆盖使变更对模型目录、`skill` 工具和 `/name` 手势生效。

该页面注册在 `@deepseek-ai/dsh-client-ui-settings` 声明的 `settings.section` 槽位上，并在首次加载后响应推送的 `skills/change`、`connection/reset`、当前会话切换，以及当前会话的 `agent-preset/selected` 而刷新。

## 模型体验

无直接影响：该浏览器端设置界面只编辑宿主设置；`dsh-skill-settings` 与 skill 消费方负责所有模型可见的结果。

#### KV Cache 影响

浏览器包不会产生模型 token，也不直接影响 KV cache。

## 已知限制与暂缓事项

- **面板按会话寻址**：列出当前会话的组合（项目、preset 与用户 skill）；开关本身仍按名称用户全局生效，因此其他位置的同名 skill 也会受影响。
- **没有搜索或分组批量操作**：网格与分组列表渲染完整目录；过滤和「整组开启」暂缓。
- **用户可见效果在输入框 `/` 菜单，不在面板**：面板渲染来自 `skill.catalog` 的有效标志，从不写入 frontmatter 或提供方文件。
