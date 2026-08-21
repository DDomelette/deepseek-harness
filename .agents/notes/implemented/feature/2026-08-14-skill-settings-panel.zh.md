# Agent Note: 用户可控的 skill 启用开关与分组设置面板

Status: implemented

[English](2026-08-14-skill-settings-panel.md) | 中文

## Problem

skill 的调用策略只能来自提供方拥有的 frontmatter（`disable-model-invocation`、`user-invocable`）。想关掉某个 skill 的用户——不想要的 superpowers 插件、吵闹的项目 skill、不信任的内置 skill——只能去改 skill 文件或卸载包。产品里没有用户可见的界面展示组装后的目录，Web GUI 的设置面也没有 skill 页，因此「这个智能体会使用哪些 skill」无法从产品内查看或控制。

## Decision

启用状态是用户覆盖，而不是提供方变更。`@deepseek-ai/dsh-skill` 新增 `ctx.skills.registerInvocationOverride(override)` —— 唯一注册的解析器 `(name) => policy | undefined`，应用于每个产出的摘要和已加载定义（在缓存之后应用，因此答案变化在下一次读取即生效，无需失效），并且只能由其精确 disposer 清除。清除活跃覆盖时会发出 `skills/change`，让持有目录的消费方重新拉取恢复后的提供方策略。所有面向模型的消费方（`dsh-tool-skill` 的目录、`skill` 工具、`/name` 手势）和面向用户的 `skill.list` RPC 本就按调用策略过滤，因此无需为每个消费方单独接线即可尊重该覆盖。可选的 `group` 字符串加入摘要、候选项、定义和运行时注册，作为不透明展示元数据；`dsh-skill-filesystem` 从 frontmatter 解析它（`group: <标签>`，类型错误的值与 `whenToUse` 一样被省略），client-safe 的 `./types` 出口现在承载该缝的 Events 声明。这项决策扩展了 [skill 系统](2026-07-05-skill-system.zh.md)及其[独立调用策略](2026-07-28-skill-invocation-policy.zh.md)，但不改变[步骤前用户调用路径](2026-08-08-user-explicit-skill-invocation.zh.md)。

`@deepseek-ai/dsh-skill-settings`（宿主侧，与 `tool-skill` 一起挂载在 base bundle）通过可选设置缝注册 `skills` 设置命名空间 `{ disabled: string[] }`，并把它送入注册表覆盖。禁用是彻底的——两个调用标志都关闭。不是合法 skill 名称的条目会拒绝写入；没有设置服务时覆盖不解析任何内容，目录行为与组合配置完全一致。命名空间的每次提交变更都会发出 `skills/change`，让持有目录的消费方（菜单、面板）重新拉取。

网关新增 `skill.catalog`，一个以 `sessionId` 寻址并与 `skill.list` 共用同一 cwd/scope 解析的配置界面 RPC：该会话组合解析出的每个 skill，带有效 `modelInvocable`/`userInvocable` 标志、用于分组的 `group` 标签与 `source` 来源桶，以及从 `skills` 命名空间读取的 `disabled` 标记。它与配置面其余部分一样在 `dsh-client-connection` 中固定在环回地址，`skills` 命名空间加入 `WEB_SETTINGS_NAMESPACES`，`skills/change` 加入转发事件 allowlist，使打开的面板和菜单在注册表变化时重新拉取。

`@deepseek-ai/dsh-client-ui-settings-skills`（客户端）注册技能 `settings.section`（order 30）：每个展示分组一个图标——声明的 `group` 标签，回退到本地化的发现来源标签——并带技能数量；点进分组显示技能列表（名称、描述、仅用户可用徽标、每个技能一个开关）。仅当每个目录 `disabled` 标记都与命名空间值一致时，加载才接受该目录与设置修订；若并发变更使二者分离，则重读一次。开关从这份完整命名空间值派生整数组补丁，保留当前会话目录外已禁用的名称，再以页面读取的 `expectedRevision` 调用 `settings.update`；成功后重载页面，遇到 `settings-conflict` 时先重载再显示冲突消息。页面寻址当前会话（已发布的 Web profile 把 skill 发现交给 preset，无 cwd 的注册表视图为空），并在首次加载后响应 `skills/change`、`connection/reset`、当前会话切换，以及当前会话的 `agent-preset/selected` 而刷新。

## Verification

注册表单测钉死覆盖行为（摘要与定义中的替换、缓存目录的重新应用、精确 disposer、重复注册拒绝）与 `group` 校验。`dsh-skill-settings` 测试钉死实时禁用/启用循环、隔离失败的失效通知广播、无设置服务时的行为、写入校验，以及 fiber 释放时的策略恢复与失效通知。网关测试钉死 `skill.catalog` 投影与协议往返；connection 测试钉死新方法的环回限制。客户端包测试钉死分组（声明分组、来源回退、排序）、store 中目录与修订一致的合并、目录外禁用名称的保留、冲突重载、进行中状态、命名空间缺失、无会话姿态与页面的网格/下钻/开关行为。一个 keyless 浏览器 e2e（`apps/web/tests/skills-settings.e2e.ts`）在组装后的组合上打开真实面板、切换一个种子 skill、断言 `settings.yaml` 的持久写入，并验证该 skill 从 composer 的斜杠菜单消失——即模型目录所读的同一个注册表覆盖。

## Alternatives considered

- **在每个消费方过滤而非在注册表** —— 拒绝：三个消费方（模型目录/工具、用户手势、RPC 列表）会各自重复实现同一覆盖连接，未来消费方还会静默遗漏。一个注册的解析器让覆盖成为所有读取已经经过的注册表读取的属性。
- **通过高优先级提供方遮蔽 skill** —— 拒绝：提供方只能贡献完整 skill；重新发布被覆盖的正文会复制内容、递归进入它所服务的注册表，并与 scope 分层和 rank 产生糟糕交互。
- **按 skill 设置行而非禁用列表** —— 拒绝：`{ name: { enabled } }` 映射迫使编辑器按任意键寻址；名称列表让面板的补丁成为整数组合并，schema 可以按 skill 名称语法校验。
- **严格按 frontmatter `group` 分组** —— 拒绝：未分组的 skill 会各自成为一个图标，十四个 superpowers skill（未声明 group）就会显示十四个图标。来源回退在不改动用户文件的情况下把它们折叠为一个本地化分组。
- **基于全局注册表视图的会话无关目录** —— 拒绝：已发布的 Web profile 禁用了宿主平面的 `skill-filesystem` 行（发现归 preset 所有），因此无 cwd 的视图为空。寻址当前会话复用了 composer 菜单所用的同一解析路径，并且能列出项目 skill。

## Consequences

- skill 启用状态可从 Web 设置中查看和控制；开关是持久的（`settings.yaml`）、带修订保护的，并通过一次注册表读取处处生效。
- 覆盖按名称全局生效：其他项目或 preset 层中的同名 skill 也会被禁用。面板列出当前会话的组合——项目、preset 与用户 skill 一视同仁——因为已发布的 Web profile 把 skill 发现交给 preset，无 cwd 的注册表视图为空。
- `skill.catalog` 协议行暴露 `source` 与 `group` 字符串（前者此前是宿主侧词汇）：消费方本地化已知来源，未知来源原样渲染。
- `skills/change` 转发在 `dsh-skill` 的 client-safe `./types` 与 `dsh-api-remotes` 之间增加一条类型化 Events 依赖，沿用既有的逐 owner `./types` 模式。
- frontmatter 增加一个可选且仅用于展示的字段（`group`）；用户未禁用的 skill 的调用语义不受影响。
