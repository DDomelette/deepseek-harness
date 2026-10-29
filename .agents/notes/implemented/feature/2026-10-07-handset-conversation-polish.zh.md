# Agent Note: 手机端打磨：共享内容列、抽屉滑动、单行输入按钮行

Status: implemented

[English](2026-10-07-handset-conversation-polish.md) | 中文

## Problem

[手机端侧边栏：悬浮品牌按钮与边缘手势](2026-10-07-handset-sidebar-fab-swipe.zh.md) 在真机验证后留下三个仅手机端的问题。对话页上消息列与输入卡片看起来偏左且不对齐：低于 768px 时宽度 clamp 的下限已退化为列宽本身，但消息区仍保留 `clearance + 16px` 的两侧内边距，而输入卡片只让出裸 clearance，共享宽度轴退化成两条不同的内边距（32px 对 16px），左缘不再一致。抽屉出现与消失都没有位移动画，与随行的遮罩相比显得生硬。输入卡的按钮行（+、带回形针与盾牌+文字+chevron 的权限 chip、模型 chip、发送）在手机宽度下折成两行。

## Decision

三处改动都以框架的 `data-sidebar-fab` 属性（覆盖区间既有的跨包契约）为准；宽屏行为不变。

ui-chat 的消息滚动区在该区间收起额外的 16px 内边距（`[data-sidebar-fab] .scroll { padding-inline: clearance }`），消息列与输入卡片共享同一 16px 边距的对称居中列，左缘严格对齐。共享宽度规则（消息区 = 卡片 − 32px）刻意只适用于非手机区间：W 已退化为列宽时，额外的内边距只会劈开共享轴。持久化的 `--dsh-chat-user-width` 拖拽偏好经过排查并排除——当 W 不低于列宽时，两个盒子都收敛到同一轴线，它不可能产生偏移。

抽屉改为滑动。进入使用挂载关键帧（`drawer-in`，从 `translateX(-100%)` 滑入；遮罩以 `scrim-in` 淡入），因为挂载中的元素无法做过渡。退出是延迟卸载：AppFrame 让栏与遮罩在 `data-closing` 下多挂载 `DRAWER_SLIDE_MS`（300ms，与 `--ds-transition-duration-slow` 一致），样式表终态（`translateX(-100%)`、遮罩 `opacity: 0`）由基础过渡从当前位置到达；窗口内重新打开会取消卸载，离开覆盖断点则立即结束窗口。关闭标志在渲染期间派生（React 认可的随 props 变化调整 state 模式），而非在 effect 中：effect 会先提交一帧完全卸载的画面，closing 标记才落地——既是一帧可见的闪烁，也让等待遮罩卸载的屏障在滑出窗口内提前放行（chat-scroll 的恢复场景的 `waitFor(detached)` 恰好撞上了这帧闪烁）。窗口期间 sidebar slot 保持展开态 owner 参数（`collapsed: false`），栏不会在滑动途中切换成悬浮按钮，遮罩也不拦截指针。边缘手势在两处集成：手势打开的挂载在整个生命周期携带 `data-gesture-driven`，从不武装进入关键帧——它会压过手势的内联跟手；释放投票关闭时，手势保留内联位置直到关闭样式落地（toggle 提交后的一个 rAF），滑出恰好从手指位置开始；保留抽屉的释放则立即清除内联位置，由基础过渡完成回弹动画。关键帧此后改为挂载期作用（`data-entering`），不再在生命周期中途抑制：手势期关掉 `animation`、释放时恢复会重播关键帧，导致关闭滑动前闪回——见[手机端真机修复](../bug-fix/2026-10-08-handset-device-layout-fixes.zh.md)。点击遮罩、Escape、抽屉内的收起按钮、手势四条关闭路径都经同一窗口退出。减少动态效果模式下保持瞬时终态。

停靠输入卡的按钮行保持单行：`[data-sidebar-fab] .root[data-composer-variant='composer'] .row { flex-wrap: nowrap }`，权限触发器收成 28px 图标触发器（隐藏文字与 chevron；权限名保留在触发器的 aria-label 与菜单行上——随后去掉 selector 填充圆底改为纯图标：[手机端真机修复](../bug-fix/2026-10-08-handset-device-layout-fixes.zh.md)）。模型 chip 在本次交付时保留文字；随后[手机端输入区图标化笔记](2026-10-08-handset-composer-icons-dock-column.zh.md)按真机反馈将其同样收成圆形图标钮。InputBar 根节点上的 `data-composer-variant` 是包内契约，把两条规则限定在停靠输入卡——首页 hero 输入卡片保留折行与带文字的权限 chip，桌面 `(pointer: coarse)` 的保留文字规则也不受影响，因为手机端规则仅在两个数据属性下取得更高优先级。

## Alternatives considered

- **把卡片加宽到消息区的内边距，而不是收窄消息区。** 否决：演示稿与用户都要求共享同一 16px 列，加宽卡片还会与桌面规则所依赖的宽度轴冲突。
- **通过移除 `scrollbar-gutter: stable` 或滚动区的 2px 外边距来修正偏移。** 作为诊断结论否决：在使用经典滚动条的宿主上，右侧 gutter 确实会把两个盒子推离视觉中心，但 gutter 预留自有其记录在案的理由（滚动条出现时卡片不跳动），而在真机上（覆盖式滚动条）它不占空间——内边距分裂才是值得修的结构性原因。此后的真机检查发现了确实保留 gutter 的配对手机浏览器，并在该区间去掉了预留——[手机端真机修复](../bug-fix/2026-10-08-handset-device-layout-fixes.zh.md)。
- **不做延迟卸载实现退出过渡**（例如抽屉常驻并以 `visibility: hidden` 隐藏）。否决：常驻抽屉会把可聚焦内容留在 Tab 序中并保持 slot 存活；300ms 的有界窗口把代价限制在动画本身。
- **用命令式动画（WAAPI）实现进入而非关键帧。** 否决：关键帧不需要 JS 也不需要 jsdom 兜底，而 `data-gesture-driven` 已经解决了唯一的冲突（手势打开的挂载），命令式路径同样要为此特判。
- **复用现有 `@container` 或 `(pointer: coarse)` 规则实现纯图标权限触发器。** 否决：container 规则仍显示 chevron，coarse 规则刻意在桌面触屏保留文字；用户的指令恰好是覆盖区间，因此双属性选择器直接陈述作用域，而不是重新定义任一既有规则。

## Consequences

- 手机端对话列在 16px 边距下对称且左缘对齐；桌面宽度轴（共享规则、宽度手柄、`--dsh-chat-user-width`）逐字节不变。
- 抽屉的每条开合路径都沿同一时长与曲线运动；单元规格固定关闭窗口、重开取消、离开断点与手势集成，mobile-drawer e2e 在真实浏览器中固定关键帧名与滑出终态 transform。
- 390px 下按钮行保持单行，权限模式一次点按可达；hero 卡片与桌面触屏行为不变。
- `data-sidebar-fab` 现有三个消费包（ui-layout 发布，ui-conversation 与 ui-chat 消费）；契约在每一侧的注释中记录，并由样式契约规格固定。
