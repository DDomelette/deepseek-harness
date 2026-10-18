# Agent Note：上游合并后的侧边栏轨道动画与 rail 图标

Status: implemented

[English](2026-10-19-sidebar-track-animation-and-rail-glyphs.md) | 中文

## 问题

丢掉手机端抽屉的那次上游对齐合并（记录在 2026-10-18-handset-drawer-restored）同时回退了桌面外壳的两处视觉表现。

侧边栏展开/收缩动画消失了。在合并后的 2.0 外壳里点击 rail 折叠按钮，grid 轨道瞬时切换，而 fork 的 1.5 外壳对同样的点击是有动画的。Chromium 不会启动"属性与时长和值变更落在同一次 style recalc"的 transition，重写后的 frame 在提交阶段同一次 render 里既翻转 collapsed 状态又武装 `data-animating`，轨道变更先于 transition 存在而落地。

收起态 rail 的图标也失去了辨识度与区分度。插件入口画的是风车轮字形，四条弧线在 rail 的 18px 下糊成一个"禁止"圈；右侧面板的展开按钮镜像自左侧边栏的折叠图标，与 dock 的 add-tab 控件撞脸——后者的 outline-plus 就在同一个角落。

## 决策

- 轨道 transition 比值变更提前一个 recalc 武装：`data-animating` 先提交 transition 的 property 与 duration，collapsed 状态翻转落在之后的 recalc，Chromium 由此在每次点击时都启动 grid-track transition。离散终态（抽屉、scrim）仍通过 `data-closing` 瞬时落地，它在第一帧就压掉 transition 与 animation。
- 轨道缓动按方向拆分：展开减速到位（`--ds-ease-out`），收起加速进入 rail（`--ds-ease-in`）。两个 token 与现有 `--ds-ease-in-out` 一起放在 ui-theme 的 base.css。
- 右面板有了自己的字形：`IconPanelRightOutline`（Regular/Medium 配对，1px 描边）把面板分隔线画在右侧，ui-sidebar-right 的展开与折叠按钮改用它，不再镜像 `IconPanelLeftOutline`。
- 插件 rail 入口重绘为 `IconPluginOutline`：单 path 拼图块，顶部榫头、右侧凹口，沿用整套字形的 16x16、1px 描边语言。风车 artwork 被移除，它没有其他使用方。

## 备选方案

- **插件 rail 入口复用 `IconCordisPluginOutline`。** 否决：fill 的四角品牌标与 rail 的 1px 描边家族风格冲突，且它已在 chat 工具视图里表示 cordis 插件工具，同一字形会出现第二重身份。
- **任务管理的时钟换成 `IconChecklistOutline`。** 否决：checklist 已用于 todo/job 工具行，而时钟的"定时"语义与自动化任务吻合；时钟在 18px 下清晰，只有风车需要更换。
- **右边缘保留镜像的 PanelLeft 字形。** 否决：镜像让展开 affordance 与同一角落 dock 的 add-tab 控件撞脸，而"分隔线在右"的字形读起来就是面板本身。
- **通过在武装与翻转之间强制 reflow 来修动画。** 否决：两阶段提交（先 `data-animating`、后状态）在 React 自己的调度内就实现了所需的 recalc 间隔，不需要同步 layout flush。

## 后果

产品图标集从 94 对增至 95 对字形；ui-primitives 图标 spec 中的数量断言同步更新。客户端包以构建后的 lib 产物被消费，而 `tsc -b` 只做类型检查不落盘——修改 ui-primitives 或客户端插件后，要先用 tsdown 重建该包的 lib 再做 `vite build`，否则浏览器仍从过期 lib 里拿到旧图标。两阶段武装只涉及 CSS/状态结构；ui-layout app-frame spec 中的抽屉套件钉住了周边的关闭路径。
