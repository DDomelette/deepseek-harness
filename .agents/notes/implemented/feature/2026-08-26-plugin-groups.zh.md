# Agent Note: Browser-local plugin groups in the inventory tab

Status: implemented

[English](2026-08-26-plugin-groups.md) | 中文

## Problem

插件列表标签页此前把每个 Loader 条目平铺成一份清单——完整部署下超过 160 行。用户无法把清单整理成命名的集合，文本搜索是唯一的导航方式。

## Decision

**浏览器本地分组 store 在保留全局与预设区块的同时过滤插件清单。**

- Store：`packages/client/ui-settings-plugin-inventory/src/client/groups-store.ts` 的 `createPluginGroupsStore()`——一个通过 `defineStore` 定义的句柄，以 `dsh.plugin.groups.v1` 持久化到 localStorage，并作为 slot 条目的 `store` 选项注册，由框架负责每条目的身份与 rehydrate。状态为 `{ groups: { id, name, entryIds }[], selection }`；`ALL_GROUP = 'all'` 是展示完整清单的保留选中值。成员保存全局 Loader 条目 id 或包含预设作用域的条目键；分组 id 由调用方铸造（组件中用 `dsh-util-crypto` 的 `randomUUID()`），因此 action 保持确定性。
- UI：分组选择器、新建分组对话框、成员编辑器和删除分组操作独立于服务端配置。成员编辑立即持久化，完成按钮关闭编辑器。全局成员接受旧的裸条目 ID；新键区分全局行与各预设的条目 ID 及模块。每张卡片的首行展示标题及状态，次行展示条目标识。启用与条件状态标签保持可见。溢出标题水平滚动，同时尊重减少动态效果设置。
- 删除分组不会删除其成员：成员重新出现在"全部"中，因为分组只是展示层叠加。已下线条目的成员 id 在渲染时按存在性过滤，分组静默缩小而不是报错。

## Alternatives considered

**Host 持久化分组（settings.yaml 或 workspace 域）。** 与用户确认后否决：分组是个人展示偏好，浏览器本地持久化与该需求匹配，且不引入线协议、schema 或设置文档的改动。

**只读分组，不提供删除/移出操作。** 与用户确认后否决；删除分组与移出成员均已交付。

**用计算切面（按来源或启停状态）代替用户分组。** 否决：命名用户集合是所述需求；计算切面之后仍可作为额外的伪分组加入。

## Consequences

清单可在不改变部署或模型输入的情况下组织。分组保留在浏览器来源内。Store 测试覆盖持久化及变更；组件测试覆盖带作用域的成员键、旧全局 ID 和预设过滤。
