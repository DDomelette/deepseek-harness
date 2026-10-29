# Agent Note: 划词浮层的定位与关闭

Status: implemented

[English](2026-09-21-notes-selection-bubble-placement.md) | 中文

## 问题

笔记的划词浮层（`SelectionBubble.tsx`）把气泡定位在选区水平中点、以 `transform: translate(-50%, calc(-100% - 8px))` 上浮，此后不再复查这个位置：

- 无视口边缘钳制：选区贴近视口左、右或顶部时气泡偏出屏幕。
- 不跟随滚动：只有 `selectionchange` 会重定位，滚动会话后气泡悬在原视口位置、盖住顶替上来的无关文本。
- 除选区自然塌陷外没有关闭途径：Escape 和滚动都不能关掉它。
- `z-index: 70` 是没有依据的魔法值；它会压在读者刻意摆放的浮动窗口（60）之上。

## 决策

定位由 `SelectionBubble.tsx` 导出的纯函数 `placeBubble(viewport, anchor, size)` 计算：气泡对选区居中，但以 8px 边距钳制在视口内（气泡比视口还宽时改为居中而非钳制），上方空间放不下气泡加 8px 间距时翻到选区下方。组件在 `useLayoutEffect` 里量取已渲染气泡的自身尺寸——定位依赖这个尺寸，而它只在渲染后存在——React 在绘制前应用结果，因此不需要「定位前隐藏」状态。翻到下方通过 `data-notes-bubble-side` 属性表达，transform 留在样式表里。

关闭行为遵循两条既有产品惯例。Escape：仅在气泡显示期间挂 document `keydown` 监听，用 `preventDefault()` 消费按键，并跳过已被 `defaultPrevented` 的 Escape——即最上层表面拥有 Escape 的惯例（[commit 21ee6424a1](https://github.com/deepseek-ai/deepseek-harness/commit/21ee6424a1)，如 `AppFrame` 跳过已被消费的 Escape）。滚动：气泡直接关闭而非跟随——fixed 定位的气泡要不逐帧重算就无法贴住滚动中的文本，而钳制在视口边缘、悬在无关文本上的气泡读起来就是缺陷；scroll 事件不冒泡，监听挂在 `window` 的捕获阶段，以便到达会话内部的滚动容器。窗口 resize 时选区仍在，因此气泡重新测量而不是关闭。

z-index 改为 30，层级依据写进样式表注释：会话层 chrome 应在框架 overlay 层（20，AppFrame）与停靠右面板（10）之上、浮动窗口（60，FloatLayer）与 tooltip chrome（100，ui-primitives）之下。

## 曾考虑的替代方案

- **滚动时逐事件重测跟随选区。** 否决：气泡只能在滚动帧之间跟随文本，且选区滚出视口后会被钳制到视口边缘、悬在无关内容上；直接关闭与选区塌陷时读者已见到的行为一致，且只需一个监听、不涉及定位计算。
- **引入 floating-ui 式中间件栈做锚定。** 以依赖体量换一个工具条不值得而否决：定位就是十二行带全分支覆盖的算术，面板其他部分也用不到这个库。
- **保留 z-index 70（高于浮动窗口）。** 否决：浮动窗口是读者刻意摆放的表面，会话的瞬态 chrome 压在它上面颠倒了窗口隐喻。

## 后果

- `notes-bubble.client.spec.tsx` 新增定位单元测试（左右钳制、宽过视口、下翻）与关闭测试（Escape 消费、已被消费的 Escape 忽略、非 Escape 忽略、捕获阶段滚动隐藏、resize 重测）;`SelectionBubble.tsx` 保持 100% 覆盖。真机探针（Chromium 跑构建产物）实测气泡与选区矩形居中对齐误差在 1px 内、上方 8px 间距，滚动与 Escape 均能关闭。
- 气泡不再压盖浮动窗口；产品中没有其他东西依赖它原来的层级。
- 选区随滚动离开视口后气泡消失，需要重新划选才能收集——作为可预期的行为接受。
