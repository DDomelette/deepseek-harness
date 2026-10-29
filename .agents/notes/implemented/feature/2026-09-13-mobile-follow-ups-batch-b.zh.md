# Agent Note: 移动端跟进，批次 B

Status: implemented

[English](2026-09-13-mobile-follow-ups-batch-b.md) | 中文

## 问题

[手机布局](2026-09-13-mobile-responsive-batch-a.zh.md)让抽屉、设置面板与会话外壳在手机宽度下可用，但该路径上仍留有四处缺口。每个按 Escape 自行关闭的界面与框架抽屉各自独立监听该键，因此一次按键会同时拆掉整个层叠：会话之上的灯箱位于打开的抽屉之内时，三者会一并关闭。设置界面中的四个原生 `<select>` 控件——Models 页面的提供方选择、该页面的模型目录与协议选择，以及插件分组选择——仍保持桌面控件高度，低于 44px 的最小触控目标。三个 web e2e 套件各自持有一份相同的“等待轨道稳定”算术的私有副本，同一套并发推理因此存在于四处。而两个覆盖整个手机屏幕的固定定位浮层——Modal 与设置面板——按原始视口确定内容尺寸，这让卡片的留白落到已安装 PWA 的状态栏与横屏刘海之下，面板顶栏落到这两条区域之下，其滚动窗格落到主屏指示条之下。

## 决策

Escape 只有一条归属规则：按该键自行关闭的界面消费该键，而框架抽屉只对无人消费的 Escape 作出反应。`ui-primitives` 的 Modal 与 Menu、`ui-layout` 的 AppFrame、`ui-directory-picker-browse` 的 DirectoryBrowser、`ui-attachment` 的 ImageLightbox、`ui-goal` 的 GoalBar、`ui-conversation` 的 ContextMeter 与 QueueDock、`ui-chat` 的 stat-dialog、`ui-settings-general` 的 SettingsRoot，以及 `ui-workspace` 的 WorkspaceBrowser 在处理 Escape 时都调用 `event.preventDefault()`；`ui-model-selection` 的 ModelSelect 与 `ui-subagent` 的 SubagentHeaderLineage 早已消费该键。`packages/client/ui-layout/src/client/AppFrame.tsx` 中的抽屉是最低优先级的归属者，因为它位于所有其他界面之下，它在 `event.defaultPrevented` 时提前返回，因此关闭最上层界面的那次按键会让抽屉保持打开。

在粗指针设备上，设置界面中的四个 `<select>` 控件带 44px 的最小触控目标（WCAG 2.5.5）：`packages/client/ui-settings-models/src/client/ModelsSection.module.css` 中针对 `select.input` 的一条 `@media (pointer: coarse) { … min-height: 44px }` 规则匹配 Models 的全部三个选择控件，`packages/client/ui-settings-plugin-inventory/src/client/PluginGroupControls.module.css` 中针对 `.groupSelect` 的一条规则匹配插件分组选择。所有桌面声明保持不变。

`apps/web/tests/support.ts` 为三个会调整窗口并测量会话几何的 web e2e 套件导出 `settleViewport(page, viewport, options?)` 与 `readSettledWidth(locator)`。`settleViewport` 应用视口，等待收起标记到达该宽度应呈现的状态，然后轮询会话列的实际渲染宽度，直到连续三帧一致；`readSettledWidth` 采样定位元素的布局宽度，直到连续三次读数一致。两者之所以存在，是因为跨过侧边栏断点会动画框架轨道，而输入卡片跟随过渡中的列，因此单次采样可能捕捉到静止布局从不会有的动画中途重叠。行为未变：`composer-tab-geometry.e2e.ts`、`plan-control-row.e2e.ts` 与 `sidebar-right.e2e.ts` 在同样的 34 处调用点调用共享辅助函数。

两个覆盖手机屏幕的固定定位浮层把安全区 inset 当作自身间距。`packages/client/ui-primitives/src/Modal.module.css` 为固定层四边加上 `max(24px, env(safe-area-inset-*))` 内边距，因此设备预留更多空间时卡片的 24px 留白加宽到该 inset，其遮罩改为 `position: fixed`，因此仍覆盖内边距让卡片避开的那两条区域。`packages/client/ui-settings-general/src/client/SettingsRoot.module.css` 在 `box-sizing: border-box` 下为手机面板加上 `padding: env(safe-area-inset-*)`，因此顶栏避开已安装 PWA 的状态栏，滚动窗格止于主屏指示条之上。报告零 inset 的设备渲染两者的结果与桌面视口完全一致。

## 曾考虑的替代方案

- **用于 Escape 归属的共享浮层栈注册表。** 否决：每个浮层都要向栈注册与注销，注册表还需要自己的排序规则、拆卸纪律与测试，才能复现浏览器已经跟踪的事实。`event.defaultPrevented` 从原生事件中带出同样的“某个界面已处理过它”这一事实，且没有需要与 DOM 保持同步的状态。
- **为所有固定定位浮层加上安全区 inset 内边距。** 否决：一刀切的规则会改变桌面视口下本就位于安全区内的对话框，并把决定权从真正接触设备区域的界面移走。覆盖手机屏幕的界面各自决定 inset 的用法——Modal 用作留白，面板用作内边距——因此不影响其他任何浮层的间距。

## 后果

- Escape 归属是按处理函数选择性加入的。新增一个按 Escape 关闭但不消费该键的浮层会让按键透传到抽屉，抽屉于是在同一次按键中关闭——这正是本规则消除的故障。代价是该规则以注释形式写在每个消费该键的处理函数处，而非由共享机制强制。
- 44px 下限只在 `(pointer: coarse)` 下生效，因此粗指针声明提高设置控件高度，而键盘与精细指针用户保持更紧凑的桌面密度。
- 共享稳定辅助函数给它们替代的每次调用增加一次等待，上限为轮询的五秒期限；回报是轨道过渡推理只保留一份而非四份。
- 安全区内边距在不存在 inset 处解析为零，因此桌面视口渲染的 Modal 与设置面板不变，手机通道的零 inset 情形锁定该行为。
- iOS 安全区与键盘行为仍无法在 CI 中验证；这仍是已接受的缺口，由真机手测覆盖，如批次 A 的记录所述。
