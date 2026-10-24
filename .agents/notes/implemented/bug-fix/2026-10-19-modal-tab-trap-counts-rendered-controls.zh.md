# Agent Note: 模态 Tab 陷阱只把真正渲染出来的控件算作边界

Status: implemented

[English](2026-10-19-modal-tab-trap-counts-rendered-controls.md) | 中文

## 问题

`useModalLayer` 掌管前台对话框内的 Tab：它按文档顺序收集对话框里可聚焦的控件，在当前控件是第一个或最后一个时把焦点折回。收集时只排除 `[inert]` 与 `[hidden]` 子树，而用 CSS 隐藏的控件两个属性都没有。手机端设置布局同一时刻用 `display: none` 隐藏一个面板（`packages/client/ui-settings-general/src/client/SettingsRoot.module.css` 里 `@media (max-width: 767px)` 块中的 `.panel[data-pane='list'] .options` 与 `.panel[data-pane='detail'] .navList` 规则），而 `SettingsRoot.tsx` 用 `useModalLayer` 驱动设置对话框。于是被算作最后一项的控件落在隐藏面板里，折回判断始终匹配不到最后一个可见控件，Tab 便离开对话框走到遮罩下的页面上；Shift+Tab 对称地离开。`Modal` 与设置外壳是这一陷阱仅有的两个消费方，因此每个对话框与手机端设置布局都带着这个缺陷。

## 决策

`packages/client/ui-primitives/src/useModalLayer.ts` 保留可聚焦查询与 `[inert]`/`[hidden]` 过滤，并在 Tab 候选过滤中加上 `rendered(element)`。只有控件本身及其祖先都会渲染时才计数：

- `visibility: hidden` 排除该控件本身；隐藏祖先内部的 `visibility: visible` 仍然可达，因为控件解析的是自己继承后的值。
- `display: none` 与 `content-visibility: hidden` 排除该控件以及声明它们的祖先之下的整棵子树；两者都无法被后代覆盖，因此祖先遍历在第一个声明处即停止。

该判断读的是计算样式而不是布局盒子，且只在前台层收到 Tab 按键时运行，因此代价随对话框的控件数量与深度产生，而非随帧循环产生。

守护用例是 `packages/client/ui-primitives/tests/modal-layer.client.spec.tsx` 中的 "traps Tab on the last rendered control and skips CSS-hidden panes"：一个 headless `Modal` 在 `display: none` 面板与 `content-visibility: hidden` 面板之后渲染两个可见控件，用例断言从最后一个可见控件按 Tab 落到第一个、从第一个按 Shift+Tab 落到最后一个。把该判断回退后只有这一条用例失败，同文件其余十一条仍然通过。

## 备选方案

**用 `getClientRects().length > 0` 过滤。** 这是最直接的"没有渲染盒子"判断，否决理由是 jsdom 没有布局引擎：在那里 `getClientRects()` 对所有元素都返回空列表，于是所有候选都会被滤掉，每次折回都落在对话框元素自身，`modal-layer.client.spec.tsx` 的 Tab 断言会失败，而与生产 CSS 毫无关系。计算样式是同一套 CSS 权威，在没有布局的 DOM 里仍然如实。

**使用 `Element.checkVisibility()`。** 这是浏览器里的平台答案，否决理由是 jsdom 没有实现它，判断就需要一条 spec 永远不会走到的回退分支；计算样式遍历用一条代码路径覆盖同样的隐藏机制。

**改为修手机端样式表**，让空闲面板挂载但不用 `display: none`。否决其作为本缺陷的修法：样式表表达的是布局，对话框不该信任调用方以陷阱能观察到的方式隐藏内容，而且任何其他用 CSS 隐藏控件的调用方仍会被错算。

**给隐藏面板标注 `hidden` 或 `inert`。** 否决：这要求每个调用方把一个布局决定镜像进 DOM，而 `inert` 是禁用它所标记的子树，不是在描述它。

## 后果

- Tab 与 Shift+Tab 在页面真正渲染出来的第一个与最后一个控件上折回，手机端设置对话框因此把焦点留在可见面板内，每个 `Modal` 也同样得到修正。
- 由这三种声明之外的机制隐藏的控件（`opacity: 0`、零尺寸裁切、移出视口定位）仍然计数。那些控件本身仍可聚焦，把它们算进去正是浏览器里 Tab 的行为。
- 该判断在每次按 Tab 时对每个候选的每层祖先付出一次 `getComputedStyle`，在其他按键、渲染与帧上不付出任何代价。
