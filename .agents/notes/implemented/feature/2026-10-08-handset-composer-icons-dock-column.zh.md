# Agent Note: 手机端输入区：模型触发器图标化、遮挡修复、共享 dock 列

Status: implemented

[English](2026-10-08-handset-composer-icons-dock-column.md) | 中文

## 问题

对[手机端打磨笔记](2026-10-07-handset-conversation-polish.zh.md)的真机验证又暴露出三处仅手机端存在的缺陷。停靠输入卡按钮行出现遮挡：权限触发器与模型 chip 的文字叠渲染在一起，回形针按钮被挤没——按钮行的 `flex-wrap: nowrap` 允许 `.tools`/`.modes` 分组收缩，而收缩的分组会让其未收缩的内容（粗指针下 44px 最小值的触发器）溢出到下一个分组。随后用户指示模型触发器也去掉文字（「将模型名字换成图标」）。对齐工作也不完整：目标 dock（以及共享其内边距约定的待办/队列 dock）仍停留在 100% − 64px 的宽度，而消息与输入卡片已共享 16px 列；统计条也在桌面内边距里居中，而不是对齐到列边缘。

## 决策

所有改动再次以框架的 `data-sidebar-fab` 属性为键，触发器规则限定在 `data-composer-variant='composer'`；宽屏与 hero 行为不变。

遮挡的修复是结构性的，而不是 z-index 补丁：`[data-sidebar-fab] … .tools, … .modes { flex: none }` 固定分组盒，触发器从此不可能渗入下一分组；单行在 390px 下诚实排布（探针实测：tools 24–180，trailing 256–356，无交集）。

模型触发器与权限触发器同款：在两个数据属性下同样收成 28px selector 填充圆形图标钮（隐藏文字、effort 与 chevron，显示 `IconDataOutline16`），刻意覆盖桌面触屏上保留文字的粗指针规则；模型名保留在触发器的 `title`/aria-label 与菜单行上。ui-conversation 的 InputBar 注释把 `data-composer-variant` 记录为 ui-model-selection 跨 slot 边界消费的契约。

目标、待办、队列三个 dock 在此区间去掉额外的 `--dsh-composer-dock-inset` 扣减，横跨共享的 clearance 宽度列，于是所有组合面（消息列、输入卡片、dock）共享同一左缘；统计条改为 `justify-content: flex-start` 并清零两侧内边距，对齐同一边缘。桌面的内边距约定（dock = 卡片上限减去内边距）刻意保持为非手机端规则，与打磨改动中的消息列内边距同理。

## 否决的方案

- **通过收缩触发器而不是固定分组来修复遮挡。** 否决：44px 最小值是粗指针的无障碍目标；布局 bug 在于分组盒谎报内容宽度，而不是目标本身。
- **保留模型文字、只修遮挡。** 被用户否决：文字 chip 正是显得拥挤的元素，图标化处理与权限触发器对称；模型名在菜单与触发器无障碍名称上一次点击可达。
- **发布共享的 `--dsh-composer-dock-width` 自定义属性，而不是逐模块覆写。** 否决：三个 dock 分布在三个包里、各有 calc 表达式，新增轴线变量反而带来第四种约定，不如每文件两条属性作用域规则直接。

## 后果

- 390px 真机探针：输入区按钮行渲染为 +、回形针、权限图标、模型图标、发送，无遮挡；消息列、输入卡片、统计条全部量得 x = 16 的共享列。
- 契约规格固定了每条新规则：ui-conversation（分组固定、dock 横跨）、ui-model-selection（图标圆钮）、ui-goal（dock 横跨）、ui-chat（统计条对齐）。
- `data-sidebar-fab` 新增两个消费包（ui-model-selection、ui-goal）；该属性仍是唯一的跨包手机端契约，每个使用点均有注释记录。
