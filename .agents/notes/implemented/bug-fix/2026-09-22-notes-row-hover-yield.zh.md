# Agent Note: 行尾控件流内展开，文本让位

Status: implemented

[English](2026-09-22-notes-row-hover-yield.md) | 中文

## 问题

[悬浮控件](2026-09-22-notes-row-overlay-controls.zh.md)取消了座位，但把控件悬浮在不透明的 `--dsw-alias-bg-layer-1` 底衬上压着文字。产品侧再次给出手动 P 图的决定：不要底衬——控件直接显示在卡片上，文本为它们让位、在控件左边的空间里 ellipsis 截断（「Windows lane」被遮的场景变成「Windows la...」)，而不是被盖住。

## 决策

`.handles` 包裹层回到行的 flex 流内但处于塌缩态：静止时 `max-width: 0; overflow: hidden; visibility: hidden`，在 `.row:hover` / `.row:focus-within` 时展开到一个宽裕的 `max-width` 上限——包裹层恰好取内容宽度，选择区 flex 收缩，标题与预览在剩余空间里省略号截断。`max-width` 过渡走主题的 fast 时长与 in-out 缓动；`prefers-reduced-motion` 去掉过渡。不测量也不猜像素宽度：上限只约束动画，归档按钮随语言变化的标签自适应。卡片自身尺寸永不变；显现选择器、焦点框、拖拽、drop 指示线、窄档 chip 收起都不动。底衬与它的点击穿透规则移除，`notes-refresh.e2e.ts` 恢复普通点击（悬浮层的中心碰撞已不存在——控件现在在内容区的右边）。

## 曾考虑的替代方案

- **绝对定位悬浮 + 悬停时给内容区加 `padding-right`。** 否决：内边距必须等于控件宽度，而归档标签的宽度随语言变化——流内塌缩自适应。
- **运行时测量控件宽度。** 否决：行的表现今天是纯 CSS，逐行的布局 effect 是塌缩方案不需要的机械。

## 后果

- 真机探针实测：静止时标题占满内容区、控件隐藏；悬停时卡片宽度不变、标题让位（186.9px → 83.7px，带省略号）、控件可见且背景完全透明、位于卡片右缘内；键盘聚焦不靠指针也能展开。
- 本条取代[悬浮控件 note](2026-09-22-notes-row-overlay-controls.zh.md) 的底衬部分——其取消座位与显现语义保留；双向交叉链接。
- 包内 433 个测试原样全绿；`notes-refresh` 黄金文件不变。
