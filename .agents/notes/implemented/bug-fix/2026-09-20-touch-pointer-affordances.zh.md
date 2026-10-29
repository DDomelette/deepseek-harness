# Agent Note: tooltip 与折叠选择器的触屏指针语义

Status: implemented

[English](2026-09-20-touch-pointer-affordances.md) | 中文

## 问题

一次手持设备评审（390×844 触屏仿真）暴露出 Web 客户端两个触屏指针语义缺陷，另有第三个疑似问题：

- 点按 rail 的「打开侧边栏」按钮后，其 tooltip 气泡一直挂在会话标题区，之后的每张截图里都在。共享的 `Tooltip` 原语在 `mouseenter` 与 `focus` 时弹出气泡；点按会合成 `mouseenter` 并把焦点留在锚点上，而触屏没有任何手势产生让气泡消失的 `mouseleave` 或 `blur`。
- composer 的权限与模型触发器在窄行上折叠成纯图标——`PermissionSelect.module.css` 在 460px 容器断点下隐藏 `.triggerLabel`，`ModelSelect.module.css` 在 360px 容器断点下把全部文字换成 Models 图标（两者都针对 InputBar `.row` 这个匿名容器）。折叠后的含义只能靠触发器的 `title` 获取，而触屏无法揭示 title，于是使用触屏的有视力用户面对的是一枚陌生的盾牌图标和一枚陌生的数据图标。
- 疑似但未经证实：在提问卡中选中某个选项后，卡片的滚动位置看起来跳回了顶部。

## 决策

- `packages/client/ui-primitives/src/Tooltip.tsx` 把气泡门控在 `(hover: hover) and (pointer: fine)` 上，于触发时求值，改在所有调用点共用的一层。hover 与 focus 两个通道都经过 `show()`，因此同时被覆盖；锚点的无障碍名称本就在其 `aria-label` 上，触屏用户不损失任何语义。引擎没有 `matchMedia` 的环境（jsdom 单元测试泳道）保持桌面答案。
- 两个选择器样式表在各自的容器查询之后追加 `@media (pointer: coarse)` 覆盖（优先级相同、源码顺序靠后生效）：权限触发器保留标签，模型触发器保留名称/推理档文字而不是替代图标。精确指针布局完全不受影响——该覆盖在那里不生效。没有新增文案：既有标签本就在各自上限内省略（`max-width: 220px`、`min(360px, 45cqw)`），composer 行的 `flex-wrap: wrap` 会在发送按钮受到任何挤压之前吸收残余压力——已通过在 390×844 下量测发送按钮的可命中性验证。
- 疑似滚动重置先做了复现：以编程方式点击选项，滚动区的 `scrollTop` 纹丝不动（137 → 137）；而 Playwright 点击一个滚出视野的选项会先把它滚进视野（137 → 12）。观察到的跳动是 Playwright 的可操作性滚动，不是产品 bug；此项不改任何代码。

## 曾考虑的替代方案

- **逐调用点门控 tooltip。** 否决：客户端所有 tooltip 都流经同一个 ui-primitives 组件，逐点传 `disabled` 会把同一个指针查询复制到十几个包里，而且下一个调用点难免忘记。
- **图标下加微标签（9-10px 文字行）。** 否决：为解决仅粗指针存在的问题，让所有用户的每个触发器都变高；而既有短标签本就放得下——权限预设只有一到三个词，模型名在 45cqw 上限内省略后仍是有信息量的前缀。
- **在打开的菜单顶部显示当前值。** 在触发器保留标签后判为冗余：菜单的选项行本就带完整标签并给当前项打勾，缺陷在于触发器匿名，不在菜单。
- **把提问卡的滚动跳动当作产品 bug 修。** 复现后否决（见上）：那是测试驱动器的 scroll-into-view，为此改动产品行为修不到任何真实用户能遇到的东西。

## 后果

- 触屏上点按不再弹出 tooltip 气泡；具备悬停能力的指针上一切照旧，包括键盘 focus 的 tooltip。
- 390×844 触屏仿真下，权限与模型触发器渲染各自的标签，发送按钮保持在视口内且可命中；桌面窄窗口的纯图标折叠不变。
- `ui-primitives/tests/tooltip.client.spec.tsx` 用 `matchMedia` 桩覆盖两种指针；`apps/web/tests/mobile-drawer.e2e.ts` 断言点按 rail 后无 tooltip、选择器带标签、发送按钮在触屏页上可点。
