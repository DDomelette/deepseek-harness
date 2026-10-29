# Agent Note: 恢复上游合并丢掉的手机端抽屉

Status: implemented

[English](2026-10-18-handset-drawer-restored.md) | 中文

## Problem

上游对齐合并（`511389989c`）为客户端外壳采纳了上游 master，只回补了 fork 手机端频段的一部分：`SIDEBAR_OVERLAY`、`data-sidebar-fab` 框架标记、侧边栏 slot 的 `fab` 悬浮品牌按钮、以及 keyed 在该标记上的消费方样式表都保住了，抽屉呈现没有。上游重写后的 `AppFrame` 不带抽屉，于是 fork 的 `data-drawer` 列、遮罩、滑入滑出、边缘滑动手势和 Escape 处理随之丢失，而合并留下了 768px 以下 `cols.sidebar = 0` 的开关，却没有对应的可见展开态。

后果是单程陷阱。768px 以下悬浮品牌按钮是侧边栏唯一的打开入口；点按它置位 `narrowExpanded` 并卸载按钮，而展开的侧边栏渲染进零宽网格列后被裁成空白。没有遮罩、没有 Escape 属主、没有 rail 内的 toggle，x=0 处还留了一条多余的拖拽手柄。在合并后的树上已复现：点按后框架网格计算为 `0px + 中栏 + 0px`，侧边栏元素量得 0×0。桌面宽度不受影响，所以该回归穿过了合并自带的检查。

## Decision

fork 1.5 的抽屉被移植到上游重写后的框架（`packages/client/ui-layout/src/client/AppFrame.tsx`）上，并与其现在身旁的上游机制共存：

- `drawerOpen = overlay && !sidebarCollapsed` 推导呈现；收起的侧边栏仍不占轨道，该列以 fixed 定位的 `data-drawer` 浮于中栏之上，配一层 aria-hidden 遮罩。进入用挂载作用域的关键帧，退出延迟卸载（`DRAWER_SLIDE_MS`），手势驱动的挂载跟手而不重放关键帧。
- 边缘滑动仅对 touch 指针生效：框架左缘 40px 内向右滑动跟手打开，向左滑动关闭，释放时行程超过抽屉宽度 35% 即吸附。行内样式持有跟手位置，store 仅在接合与释放时翻转。
- 抽屉是最低优先级的 Escape 属主；遮罩点按、未被消费的 Escape、侧边栏的收起控件、以及面板选择都经同一个 `toggleSidebar` action 关闭。`stores.ts` 把这次关闭折进 `selectPanel`（仅限 overlay 频段），`setViewportWidth` 在 768px 与 1024px 两个断点跨过时都丢弃窄屏展开覆盖。
- 侧边栏 slot 在滑出全程保持展开态 owner 参数（`collapsed: false`、`drawerWidth`），列不会在中途换回悬浮按钮；侧边栏拖拽手柄在 overlay 频段被守卫排除。

`service.ts` 恢复了"选择即关抽屉"的契约行，ui-layout README 以两种语言重新记录了该频段。行为由 `tests/app-frame.client.spec.tsx` 的抽屉套件和 `tests/layout-store.client.spec.ts` 中恢复的两个测试钉住（ui-layout：7 个文件，142 个测试）。

## Alternatives considered

- **丢弃 overlay 频段，跟随上游：任何宽度都保留控制栏。** 被拒绝：fork 的手机端工作——悬浮按钮、会话头部两行折行、composer 避让规则及其测试——全部 keyed 在 `data-sidebar-fab` 上，而抽屉是该频段打开侧边栏的唯一通路。保留频段却不要抽屉，等于保留陷阱。
- **在 ui-sidebar 内部渲染抽屉而非框架内。** 被拒绝：列的呈现归框架所有（网格轨道、拖拽手柄、遮罩层叠次序），且 fork 已有经过评审的实现可移植；拆分所有权会重新争论 README 已定义的框架/侧边栏边界。
- **保留半合并状态并给死局写文档。** 被拒绝：手机上的文档化陷阱仍是陷阱，而移植的成本有界——1.5 的实现、CSS 近乎原样搬入，TSX 适配 `data-animating` 轨道缓动。

## Consequences

轨道缓动（`data-animating`）对抽屉开关是无操作：overlay 频段的侧边栏轨道在两个状态下都是 `0px`，离散开关计数器会触发但没有可见过渡。overlay 频段的鼠标保留文字选择，因为滑动只对 touch 生效；鼠标经悬浮按钮、遮罩点击和 Escape 操作抽屉。同一次合并留下的其余 handset 缺口——设置单栏布局、safe-area 内边距、两条 handset CSS 覆盖——已记录在发现该回归的评审中，属于后续工作，不在本决策范围内。
