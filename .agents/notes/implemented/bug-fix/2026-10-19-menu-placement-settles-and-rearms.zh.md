# Agent Note: 菜单定位循环在测得稳定后停下，并在运动信号到来时重启

Status: implemented

[English](2026-10-19-menu-placement-settles-and-rearms.md) | 中文

## 问题

打开着的 portal `Menu` 在列表整个生命周期里跑着一个 `requestAnimationFrame` 定位循环，每一帧都读锚点的 `getBoundingClientRect()` 以及列表的 `offsetWidth` 与 `offsetHeight`。因此一个静止的打开菜单会在关闭之前每一帧都强制一次样式与布局计算。这个循环的存在理由是：祖先可以在没有任何 scroll 与 resize 的情况下移动锚点——拖拽、transform 过渡、关键帧动画——而那种移动是真实的；但为捕捉它而在菜单静止时逐帧测量并不成立。

## 决策

`packages/client/ui-primitives/src/Menu.tsx` 在列表打开时于绘制前定位一次，之后在帧循环里测量，连续 `SETTLE_FRAMES = 2` 次测量都没有变化就停下。一次测量覆盖锚点四边（`left`、`top`、`right`、`bottom`）与列表尺寸（`offsetWidth`、`offsetHeight`）；与上一次测量有任何差异都会把计数归零，因此锚点或列表仍在移动时循环继续跑。

六个信号会重新武装它：捕获阶段的 `scroll`（嵌套面板的滚动因此也算）、`resize`、按住指针按键时的 `pointermove`、`transitionrun`、`animationstart`，以及列表的重新渲染。scroll 与 resize 监听器立即定位、再跟踪该运动之后的若干帧，打开时的那次测量同样如此，因为列表挂载后的头几帧里还可能自行稳定尺寸。指针、transition 与 animation 监听器则为下一帧启动循环。重新渲染经定位 ref 在绘制前再定位一次——循环已停时若不再定位，新尺寸就不会被夹取。

依赖的不变量：锚点的每一次移动都会在它绘制之前由上述某个信号宣告。拖拽由第一个带按住按键的 `pointermove` 宣告，transform、transition 与关键帧由 `transitionrun` 或 `animationstart` 宣告，滚动与视口变化由 `scroll` 与 `resize` 宣告，列表自身内容的变化则由产生它的那次重新渲染宣告。因此已经停下的循环是在该运动的这几帧之内被重新武装的，而不是在它之后。

定位在实例 ref 中保存最近提交的视口坐标，仅在坐标变化时调用 React 状态 setter。从函数式 updater 返回旧值仍会由提交后的定位 effect 提交更新；浮动面板拖拽期间，这些提交可能反复嵌套，直到 React 拒绝更新，slot 随之移除菜单所属组件。关闭菜单或禁用 portal 定位会同时清空坐标与渲染位置。帧循环仍独立测量运动与列表尺寸，不依赖定位是否需要渲染。

## 备选方案

- **用 `ResizeObserver` 观察锚点。** 否决：它报告盒子尺寸变化而不是位置变化，拖拽与 transform 因此仍然需要帧循环；而且它会弄坏一个 spec。`packages/client/ui-sidebar-documentpreview/tests/zoom-viewport.client.spec.tsx` 用单个捕获回调槽位 stub 掉 `ResizeObserver`，`Menu` 再构造一个观察器就会覆盖该预览所驱动的那个回调。
- **继续逐帧测量，但让单次测量更便宜。** 否决：锚点矩形与两次 `offset*` 读取正是这个循环存在的理由，而跨帧缓存它们恰恰在祖先移动锚点时失效。

## 后果

- 静止的打开菜单从每帧一次测量变成每个信号一次测量，代价随运动而不是随列表生命周期产生。
- 接受的取舍：既没有重新渲染、也没有事件的尺寸变化——列表内部没有任何 prop 变化引起的重排——要等到下一个信号才被夹取位置。运动本身不受影响，因为上面的不变量正是定位它的依据。
- `atoms.client.spec.tsx` 钉住三条路径：测量稳定后各帧不再调用 `getAnchorRect`，`scroll` 立即定位并重启跟踪，重新渲染会让已停下的菜单重新定位。
