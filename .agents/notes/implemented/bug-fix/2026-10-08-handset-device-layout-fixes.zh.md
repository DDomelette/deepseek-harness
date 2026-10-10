# Agent Note: 手机端真机修复:去滚动条槽位居中、紧凑输入行、触发器纯图标、抽屉关键帧重播修复、抽屉选中关闭

Status: implemented

[English](2026-10-08-handset-device-layout-fixes.md) | 中文

## 问题

对批次 A 手机端表面的一次配对真机检查([手机端打磨](../feature/2026-10-07-handset-conversation-polish.zh.md)、[手机端输入区图标化](../feature/2026-10-08-handset-composer-icons-dock-column.zh.md))暴露出桌面视口测试未发现的五处缺陷。

会话内容列在设备上仍然读作偏左:该设备的浏览器显示占用布局的滚动条,而 ConversationRoot 的滚动容器无条件保留 `scrollbar-gutter: stable` 加 2px 右侧外边距,居中内容列因此向左偏离视觉中心半个保留宽度。打磨改动当初拒绝动这个槽位,理由是真实手机不会保留空间——对叠加式滚动条引擎成立,对配对设备上的浏览器不成立。

停靠输入卡的按钮行溢出卡片:`(pointer: coarse)` 的 44px 下限把行内每个按钮撑大,六个 44px 控件加间距放不进约 358px 的卡片,在 `flex-wrap: nowrap` 与分组 `flex: none` 的约束下,发送按钮被挤出卡片右缘、部分超出视口。权限与模型触发器的 28px selector 填充圆底在该密度下也读作杂乱;用户指示改为纯图标(「直接展示图标即可」)。

抽屉打开时的左滑关闭手势会抽搐:列先向左缘闪回再滑出。手势区间的抑制规则(`[data-sidebar-gesture] { animation: none }`)在手势期间关掉 `animation` 属性、松手时又恢复,这会**重新播放** `drawer-in` 入场关键帧——运行中的关键帧同时压过内联跟踪位置与关闭终态,具体可见序列取决于重播的样式重算相对于关闭提交的落点。

点选会话行后,抽屉也会继续盖在刚选中的会话上方。会话导航会把主 slot 切回会话界面,但没有面向布局的抽屉关闭动作,因此手机端每次点选后都还需要再点一次遮罩或按 Escape。

## 决策

所有规则仍限定在框架的 `data-sidebar-fab` 手机端区间(composer 行另加 `data-composer-variant='composer'`);宽屏与 hero 行为不变。

滚动容器在此区间去掉保留:`[data-sidebar-fab] .scrollBody { margin-right: 0; scrollbar-gutter: auto }`,叠层 composer 座位的条宽补偿随之去掉(`right: 0`)。叠加式滚动条引擎上无变化;占用布局的滚动条下居中列重新对称。滚动条本身在此区间一并隐藏(`scrollbar-width: none` 加 WebKit 的 `display: none` 伪元素规则,与 ui-chat 的 TurnNavigator 滚动容器同一模式):在占用布局的引擎上,即使没有槽位保留,可见滚动条仍会从右侧压缩居中列的内容盒。接受的残余:小于 768px 的桌面窗口随之失去消息区的滚动指示——接受它是因为这类窗口是拖拽过渡态,不是设备。此后用户要求恢复滚动指示,隐藏与去掉保留被逆转为对称的 `stable both-edges` 槽位,滚动条与居中兼得:[手机端转录滚动条](../feature/2026-10-09-handset-transcript-scrollbar-both-edges.zh.md)。

停靠 composer 行相对粗指针下限恢复绘制尺寸:`[data-sidebar-fab] .root[data-composer-variant='composer'] .row button { min-width: 28px; min-height: 28px }` 让 28px 图标触发器与 34px 发送钮保持设计尺寸,按钮行得以保持单行,发送钮留在卡片内。44px WCAG 下限在粗指针下的其他一切位置(含 hero 卡)仍然适用。卡片内的附件控件现已豁免该下限,改为保持徽章绘制尺寸并配透明热区:[手机端附件徽章与输入框触摸下限的冲突](2026-10-10-handset-attachment-badge-safearea-rotation.zh.md)。

权限与模型触发器在此区间去掉 selector 填充圆底:透明背景、`label-secondary` 图标色、28px 盒内 16px 图标(比带圈的 14px 大一号,在无填充时保持视觉重量)。文字与 chevron 保持隐藏;名称留在 aria-label/title 与菜单行上。附件控件保留圆形。

抽屉的入场关键帧改为挂载期作用,取代抑制式门控:新的 `data-entering` 属性只在全新的、非手势驱动的挂载上武装 `drawer-in`/`scrim-in`——滑出窗口内的重新打开改从滑出中途位置过渡回去——该标志在关键帧自身时长后清除(300ms `DRAWER_SLIDE_MS` 兜底,因为 reduced motion 丢弃动画时 `animationend` 不可靠),或在滑动手势进入时清除。手势区间现在只带 `transition: none`;挂载之后再没有任何规则切换 `animation`,关键帧因此不可能重播。`data-gesture-driven` 保留为单元测试钉住的挂载标记,但它的 CSS 规则已删除——手势挂载根本不会设置 `data-entering`。

手机抽屉的关闭是"选中主面板"的后果,因此它落在布局存储里:`selectPanel` 在 `viewportWidth < SIDEBAR_OVERLAY && narrowExpanded` 时收起抽屉,其余状态一概不动。会话导航与抽屉自己的面板行本来就调用这同一个方法,所以没有任何调用方需要额外请求一次关闭,`ctx.layout` 也不必新增一个手机专属命令;挤压区间与桌面侧边栏偏好不受影响,被后续导航取代的异步打开也不会到达关闭动作。

## 已考虑的替代方案

- **手机端保留 `scrollbar-gutter: stable`**(打磨笔记的立场)。因新的真机证据而被取代:配对设备的浏览器确实保留槽位,保留它只损失居中而换不来它本应提供的卡片稳定;卡片跳动是经典滚动条的桌面问题,768px 以下的残余已接受。
- **停靠行内保留 44px 下限**(输入区图标化笔记的立场)。因真机表现而否决:六个撑大的控件放不进卡片,且失败模式比小触摸目标更糟——发送按钮会离开视口。该下限在此行之外仍是规则。
- **用 `animation-play-state: paused` 做手势期抑制,而不是去掉 `animation: none` 切换。** 否决:暂停的动画仍应用其冻结的关键帧值,恰好会在手指按下期间压过手势的内联跟踪。
- **用 `onAnimationEnd` 清除关键帧标志。** 否决:reduced motion 会完全丢弃动画,事件永不触发、标志卡死;时长兜底两条路径都覆盖。
- **通过 `sidebar.workspaces` 的属主共享下传 `collapseSidebar` 回调。** 否决:收起是面板选择的结果,不是浏览区域的渲染职责;布局存储已经持有叠层区间事实,能在其他区间把它变成 no-op。
- **把关闭动作作为新的跨插件方法发布到 `ctx.layout`。** 评审中否决:它唯一的消费者会是工作区导航,于是通用的面板过渡面——以及它的每一个实现、替身与投影——都要背上一个手机专属命令。把它折进调用方本来就会发起的"选中主面板"里,后果就留在拥有抽屉的那个服务内。

## 后果

- 390×844 触摸真浏览器验证(无密钥 scaffold,播种中文转写):消息列与输入卡片均为对称 16px 内边距(390px 视口下 `column`/`card` 为 16→374),行内按钮实测 [28, 28, 28, 28, 34]、零溢出,发送钮右缘落在卡片内;关闭滑动在滑出途中采样为 `animationName: none`、`translateX ≈ −195`——只滑出,不再闪回。
- 样式契约与导航测试随行为同步:composer-handset-fab 钉住纯图标权限触发器与紧凑下限,model-select-handset-fab 钉住纯 Models 图标,布局存储规格钉住抽屉关闭的作用域(仅叠层区间),app-frame 规格钉住 entering 标志的武装、超时清除、手势进入清除与窗口内重开不再武装,工作区服务规格钉住导航先选中、再展示会话。mobile-drawer e2e 现在会点选会话行并断言抽屉关闭,并钉住手机端滚动容器的计算样式槽位(已随对称预留更新:[手机端转录滚动条](../feature/2026-10-09-handset-transcript-scrollbar-both-edges.zh.md));chat-scroll-contract 的 openSeed 改为等待点选结果自行关闭抽屉,不再用手动收起点击去撞滑出卸载。该 lane 与 composer-tab-geometry 全绿,chat-scroll-contract 有两条在本 Windows 宿主的干净树上同样失败(宿主工具执行问题,与布局无关)。
- 本笔记取代两条所属笔记中的两点:打磨笔记的槽位否决与其 `animation: none` 手势抑制,以及输入区图标化笔记的 selector 填充圆底与行内 44px 下限。两篇笔记的已实现事实段落均指向此处。
