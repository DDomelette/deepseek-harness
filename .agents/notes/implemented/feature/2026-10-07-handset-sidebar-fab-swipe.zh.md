# Agent Note: 手机端侧边栏：悬浮品牌按钮与边缘手势

Status: implemented

[English](2026-10-07-handset-sidebar-fab-swipe.md) | 中文

## Problem

[移动端响应式布局 A 批](2026-09-13-mobile-responsive-batch-a.zh.md) 为框架引入了手机区间：窗口宽度低于 768px（`SIDEBAR_OVERLAY` 断点）时展开的侧边栏以抽屉形式浮于中栏之上，但求解仍保留 56px 控制栏作为抽屉在屏幕上唯一的触发入口。在约 390px 宽的手机上，控制栏占去中栏 14% 的宽度，而其其余职能（New Session、工作区与搜索图标、Settings）都有抽屉自身可达的重复路径；A 批还直接否决了滑动手势，进出导航只能依赖较小的点按目标。

## Decision

低于 `SIDEBAR_OVERLAY` 断点时，收起态的侧边栏不再占用网格轨道。`packages/client/ui-layout/src/client/AppFrame.tsx` 在 `computeColumns` 求解之后丢弃控制栏宽度（columns.ts 为挤压区间及其自身测试保留 0→控制栏的语义），因此手机端中栏始终按框架全宽渲染。`SidebarOwnerProps` 新增 `fab: boolean`；ui-sidebar 的 SidebarRoot 在 `collapsed && fab` 时渲染一个固定在框架左上角的 36px 圆形品牌按钮（top 18px、left 10px、`--dsw-alias-bg-base` 底色、0.5px `--dsw-alias-border-l2` 边框、与遮罩同级的 z-index 12），承载 24px 的 `sidebar.brand.mark` slot 与现有的 `toggle.open` 提示。该按钮即是收起态的全部渲染树；抽屉本身——内容、遮罩、Escape、点击遮罩——完全不变，打开抽屉会翻转 `collapsed`，按钮随之卸载。

框架新增跟手边缘手势，在 AppFrame 内按 DragHandle 的模式实现（ref + rAF + 命令式样式，指针频率下零 store 写入）。框架上的 `pointerdown` 记录手势候选——仅在该断点下生效：收起时只认距框架左缘 40px 以内，抽屉打开时任意位置。行程不足 8px 仍是点按，垂直占优的行程让位给嵌套滚动区。手势激活时捕获指针、为框架标记 `data-sidebar-gesture`（按 `data-dragging` 的方式抑制轨道过渡），打开类手势还会立即翻转 `toggleSidebar` 让抽屉挂载；随后每个动画帧按激活时确定的抽屉宽度命令式写入栏的 `translateX` 与遮罩透明度。关闭类手势保持 store 打开，在释放时结算。释放时行程超过抽屉宽度 35% 即吸附到手势一侧，否则弹回；结算与实时状态比较，因此手势中途被 Escape 关闭的抽屉不会被重新翻开。凡手势持有栏的位置，抽屉动画都被抑制——指针按下期间框架的 `data-sidebar-gesture`，以及跳过进入关键帧的挂载期 `data-gesture-driven`——因此内联跟手从不与 CSS 缓动冲突；抽屉的进入/退出动画及其与这些抑制点的集成见[手机端打磨：共享内容列、抽屉滑动、单行输入按钮行](2026-10-07-handset-conversation-polish.zh.md)。

会话头部通过数据属性让位，因为功能插件之间禁止互相导入：框架在该区间携带 `data-sidebar-fab`，ui-conversation 的 ConversationRoot.module.css 以 `[data-sidebar-fab] .header { padding-left: 60px }` 规则让位（10px 边距 + 36px 按钮 + 14px 净空；属性选择器不被 CSS module 本地化）。两侧都在注释中记录该约定，app-frame 规格固定属性本身，另有一个样式规格固定内边距规则。

## Alternatives considered

- **保留控制栏作为抽屉触发入口**（A 批的决定）。否决：在手机上控制栏的代价几乎换不到价值，且 A 批否决滑动手势的理由——与各栏拖拽手柄的手势面冲突——在 768px 以下并不成立：该区间不渲染侧边栏拖拽手柄，右侧面板也占不到轨道。A 批笔记的 Decision 一节现指向本笔记。
- **由 AppFrame 渲染该按钮**。否决：品牌标记属于侧边栏的 `sidebar.brand.mark` slot；框架自有的按钮会分叉品牌组合以及该 slot 所服务的部署替换路径。框架只传一个 `fab` 标志，每一个像素仍归占用方所有。
- **经布局 store 驱动手势**（在 `layoutInfo` 中存放实时的抽屉偏移）。否决：指针频率的 store 写入会重渲染框架，重渲染会与手势自己的内联样式相互打架；DragHandle 的 ref 加 rAF 纪律已经拥有这类交互。
- **为释放吸附加 CSS 过渡**。当时否决：抽屉当时无过渡的呈现是命令式跟手安全的前提，瞬时结算也与当时的出现/消失行为一致。[手机端打磨](2026-10-07-handset-conversation-polish.zh.md) 此后在上述抑制点之上交付了抽屉的进入/退出动画与回弹过渡。

## Consequences

- 手机端中栏多出 56px；768px 以上的控制栏、其几何与测试不受影响，computeColumns 的约定由 AppFrame 内一处局部修正承载，而非新增参数。
- 手势常量（40px 左缘带、8px 起步行程、35% 吸附阈值）是交互不变量，由 app-frame 规格的阈值、弹回、取消、垂直让位与手势中 Escape 各用例固定，不属于部署配置。
- 品牌标记 slot 新增第三个渲染位置；生成的客户端 slot 目录记录 `fab` owner 标志。
- `apps/web/tests/mobile-drawer.e2e.ts` 现断言零轨道；抽屉的无障碍名称（`Open sidebar`）不变，因此其他驱动抽屉的 e2e 套件无需改动。
