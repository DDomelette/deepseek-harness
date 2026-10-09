# Agent Note: 手机端 Session 头部：两行标题布局

Status: implemented

[English](2026-10-09-handset-session-header-two-rows.md) | 中文

## Problem

手机端会话页的设备使用暴露了 Session 头部单一标题行放不下其内容：面包屑（`min-width: 0` + `overflow: hidden`）在 preset 标签、后台任务 chip、日程目录与工具/角落控件旁边被挤压到消失，于是会话标题——这一行里最主要的信息——恰恰在最需要导航上下文的设备上不可见。用户指示了拆分，并在部署后的版本上进一步明确了排布：标题独占第一行，preset（模式）名引领第二行，后台会话数与其余内容跟随其后。

## Decision

拆分是纯 CSS，只作用于手机区间（frame 的 `data-sidebar-fab` 属性，即 [手机端打磨](2026-10-07-handset-conversation-polish.zh.md) 确立的跨包手机契约）；宽屏布局逐像素不变，插槽声明、注册与 DOM 结构都不动。在 `ConversationRoot.module.css` 中，`.titleCluster` 与 `.headerActions` 盒子压平为 `display: contents`，使面包屑与各动作条目成为可折行 `.titleRow` 的直接 flex item；显式 `order` 值把它们分成两行——面包屑为 1 且带 `flex: 1`（伸展既保住省略号又让标题占满整行），占满整行的 `::after` 折行伪元素为 2，全部动作条目与工具/角落组为 3。order 并列按 DOM 顺序解析，而 `::after` 是最后一个子节点，因此每个第二行条目都带着越过折行点的显式 order；第二行内部的并列回落到 actions 插槽自身的顺序，于是 preset 标签（注册时 order −10）无需任何按条目标记即引领该行。`.headerUtilities` 保留盒子以用 `margin-left: auto` 把它与角落组钉在第二行右缘。头部的 76px 量值只与桌面侧边栏对齐；手机区间没有轨条，头部自然长高以容纳两行。DOM 顺序不变，读屏顺序保持逻辑顺序。

## Alternatives considered

- **新增专用插槽 `conversation.session.header.mode`，并把 ui-agent-preset 改注册进去。** 否决：它要改动公共 SlotMap 契约、slots 参考文档、ui-schedule 的顺序固件与全部头部测试，而诉求只是手机端的视觉排布——且要保持桌面"标签跟在标题旁"的位置仍需同样的压平技巧。
- **用 `only` id 过滤把 actions 插槽渲染两次**（一次给 preset，一次给其余）。否决：重复挂载条目会复制其状态与弹层，且在 ui-conversation 里硬编码 `agent-preset` 条目 id 比任何样式规则都耦合得更紧。
- **用 `data-conversation-header-preset` 属性把标签锚定到第一行右缘**（`data-sidebar-fab` 的跨包模式）。因用户的位置指示而否决：标签引领第二行时，actions 插槽的 DOM 顺序本就把它放在最前，该属性成了没有职责的机制，只存在了一轮迭代。
- **通过 DOM 重构给第二行包一个真实容器。** 否决：任何结构改动都会落到桌面端，或按断点分叉 markup；`::after` 占满整行的折行不需要包装元素即可强制换行。

## Consequences

- 手机宽度下会话标题以全宽独占第一行并在该行省略；第二行以 preset 名开头，随后是后台任务 chip、日程目录、工具与角落控件，工具/角落组钉在右缘；视图标签页仍居其下独立一行。
- 契约测试钉住该排布：ui-conversation 的 `conversation-header-fab` spec 对样式表源码逐条断言（折行、压平、面包屑 order、折行伪元素、第二行兜底、工具组钉右）。
- 390px 真浏览器探针（免密钥脚手架，种下记录 `minimal` preset 的会话）：面包屑在第一行量得 x 60→257，"Minimal mode" 标签在第二行 x 60 处开头，工具与角落按钮钉在第二行右缘。
- 没有新增跨包属性契约：拆分只需 frame 上既有的 `data-sidebar-fab`。

## Related

- [手机端打磨](2026-10-07-handset-conversation-polish.zh.md)——`data-sidebar-fab` 区间契约与共享内容列。
- [手机端 composer 图标化](2026-10-08-handset-composer-icons-dock-column.zh.md)——composer 行的同类手机区间排布。
