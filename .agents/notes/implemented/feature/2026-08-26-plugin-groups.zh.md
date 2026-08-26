# Agent Note: Browser-local plugin groups in the inventory tab

Status: implemented

[English](2026-08-26-plugin-groups.md) | 中文

## Problem

插件列表标签页此前把每个 Loader 条目平铺成一份清单——完整部署下超过 160 行。用户无法把清单整理成命名的集合，文本搜索是唯一的导航方式。

## Decision

**一个浏览器本地分组 store 把标签页变成双列视图：左侧是用户自建分组，右侧是选中分组的插件。**

- Store：`packages/client/ui-settings-plugin-inventory/src/client/groups-store.ts` 的 `createPluginGroupsStore()`——一个通过 `defineStore` 定义的句柄，以 `dsh.plugin.groups.v1` 持久化到 localStorage，并作为 slot 条目的 `store` 选项注册，由框架负责每条目的身份与 rehydrate。状态为 `{ groups: { id, name, entryIds }[], selection }`；`ALL_GROUP = 'all'` 是展示完整清单的保留选中值。成员保存稳定的 Loader 条目 id；分组 id 由调用方铸造（组件中用 `crypto.randomUUID()`），因此 action 保持确定性。
- UI：左栏列出"全部"与用户分组及其实时成员数；`+` 按钮弹出命名对话框（空名或重名禁用"保存"），悬停按钮删除自建分组。选中分组会把右栏过滤为其成员，并显示"添加插件"按钮，其选择器列出未进组的条目，带复选框、搜索框、实时"已选择 N 个"计数以及取消/添加。成员卡片带"移出分组"按钮；视口窄于 680px 时两列堆叠。在自建分组内启停小标签只保留状态圆点（条目停用时为灰色）；标题超出卡片宽度时以横向滚动（ResizeObserver 测量，遵循 `prefers-reduced-motion`）代替截断。
- 删除分组不会删除其成员：成员重新出现在"全部"中，因为分组只是展示层叠加。已下线条目的成员 id 在渲染时按存在性过滤，分组静默缩小而不是报错。

## Alternatives considered

**Host 持久化分组（settings.yaml 或 workspace 域）。** 与用户确认后否决：分组是个人展示偏好，浏览器本地持久化与该需求匹配，且不引入线协议、schema 或设置文档的改动。

**只读分组，不提供删除/移出操作。** 与用户确认后否决；删除分组与移出成员均已交付。

**用计算切面（按来源或启停状态）代替用户分组。** 否决：命名用户集合是所述需求；计算切面之后仍可作为额外的伪分组加入。

## Consequences

清单在不动部署的前提下变得可整理，模型与线协议侧均无变化。分组不跨浏览器或 Host home 漫游（已记录为限制）。组件与 store 测试守住该包的逐文件 100% 覆盖率门槛；`settings-chrome` e2e 通过组装后的应用驱动 新建 → 添加 → 刷新持久化 → 清理，golden 行标记与新双列一并固定。
