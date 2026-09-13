# Agent Note: 移动端响应式布局，批次 A

Status: implemented

[English](2026-09-13-mobile-responsive-batch-a.md) | 中文

## 问题

手机通过 [LAN Web 服务](../architecture/2026-09-11-lan-web-serving.zh.md)访问 Web UI，但外壳只交付了桌面布局。在 1024px 侧边栏自动收起线以下，手动展开的侧边栏会把会话列挤压到手机宽度的残余空间；会话内容宽度固定以 680px 为下限，在约 390px 的手机列上溢出；宽度拖拽手柄与输入栏不足 44px 的按钮都按鼠标设计；而 `100vh` 高度链加上缺少 `viewport-fit` 与 `interactive-widget` 的 viewport meta，使输入区被移动端地址栏与主屏指示条遮挡。

## 决策

框架获得一个手机区间。`packages/client/ui-layout/src/client/columns.ts` 中的 `SIDEBAR_OVERLAY = 768` 把窄屏范围一分为二：768px 与 1024px 的 `SIDEBAR_AUTO_COLLAPSE` 之间挤压行为不变，而低于 768px 时展开的侧边栏脱离栏网格——求解保留 56px 控制栏，侧栏以抽屉（`data-drawer`）形式浮于中栏之上，背后是一层 aria-hidden 遮罩（`data-drawer-scrim`）。点击遮罩或按 Escape 通过同一个 `toggleSidebar` 动作关闭抽屉；控制栏仍是抽屉的触发入口，侧边栏拖拽手柄在抽屉态下不渲染。布局存储在 1024px 以下翻转 `narrowExpanded` 而非宽度偏好，并在视口沿任一方向跨过 768px 或 1024px 断点时丢弃该覆盖，因此每个区间都以收起状态打开。

ui-conversation 让内容宽度轴适配列宽。内容宽度 clamp 的下限从固定 680px 改为 `min(680px, 列宽)`，因此低于 680px 时下限退化为列宽本身，手机宽度的列不会溢出；64% 的自适应项与 920px 的行长上限不变。宽度手柄是鼠标设施，在 `(max-width: 767px), (pointer: coarse)` 下隐藏。吸附底部的输入区座位增加 `env(safe-area-inset-bottom)` 内边距，以避开手机的主屏指示条；在粗指针设备上，输入栏按钮的最小触控目标为 44px（WCAG 2.5.5）。

`apps/web` 在 viewport meta 中声明 `viewport-fit=cover` 与 `interactive-widget=resizes-content`，外壳高度链（`html`、`body`、`#root`）使用 `100dvh`，因此布局跟随移动浏览器动态视口在地址栏收起时的变化，以及键盘对内容区的挤压。挂载根还承载顶部与左右安全区 inset（`env(safe-area-inset-top)` 与 `env(safe-area-inset-left/right)`），并设置 `box-sizing: border-box`，因此已安装 PWA 的状态栏与横屏刘海都不会遮挡头部或侧栏开关；底部 inset 仍由贴合主屏指示条的输入区座位承担。

覆盖：e2e 通道新增 `newMobilePage` 辅助函数（390×844、触摸）与 `mobile-drawer.e2e.ts` 三个用例——无横向溢出、抽屉开合、输入区可见且可聚焦；桌面黄金场景回放不变。

## 曾考虑的替代方案

- **为窄视口替换外壳的 slot 骨架。** 否决：组合外壳的子 slot 声明与 owner props 契约都需要重写，对第一版手机适配代价过高。
- **独立的 `ui-mob-shell` 包。** 以同样的理由否决：它会分叉 slot 组合与每一份 owner 契约，而不是适配同一个外壳。
- **用滑动手势开合抽屉。** 本批次否决：边缘滑动与列拖拽手柄的手势区域冲突，因此抽屉只通过控制栏按钮、点击遮罩与 Escape 开合。

## 后果

- 桌面路径不受影响：每个新分支都以 768px 常量或粗指针媒体查询为条件，桌面 e2e 黄金场景回放全绿。
- iOS 安全区与键盘行为无法在 CI 中验证；这是已接受的缺口，由真机手测覆盖，而手机通道会锁定零 inset 的情形——此时所有请求的 inset 都必须解析为不产生内边距。
- 会话外壳之外的次要界面保持桌面布局；设置面板有自己的手机布局（[手机上的单窗格设置面板](2026-09-13-settings-single-pane-handset.zh.md)），而覆盖手机屏幕的固定定位浮层把安全区 inset 当作自身间距（[移动端跟进，批次 B](2026-09-13-mobile-follow-ups-batch-b.zh.md)）。
