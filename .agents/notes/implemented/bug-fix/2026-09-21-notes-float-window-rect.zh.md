# Agent Note: 笔记浮窗按自身矩形打开

Status: implemented

[English](2026-09-21-notes-float-window-rect.md) | 中文

## 问题

笔记面板的「浮出为窗口」控件调用[右侧栏停靠表面](../feature/2026-09-04-right-sidebar-docking-infrastructure.zh.md)的 `float(tabId)` 时不传矩形，窗口因此落到 dockkit 的层叠默认值：380×300（`FLOAT_DEFAULT_SIZE`)、位置 (160,120)（`FLOAT_ORIGIN`)。实测：浮窗以约 380×280 打开并压住左侧边栏；该宽度低于面板自身的 560px 双栏断点，导航栏按钮折行、标题截断成「对..对话」，浮出状态基本不可读。

## 决策

笔记 face 现在传入显式矩形。`packages/notes/notes/src/client/face.ts` 的 `notesFloatRect(viewport)` 返回 640×480（按视口减去 24px 边距收缩），贴视口右缘（即停靠列原来的位置）、垂直居中；`present` 在点击时用 `window.innerWidth/innerHeight` 计算并传给 `frame.float(tab, rect)`——sidebar-right 服务本就接受可选矩形，宿主机制不变。640px 落在面板自身的双栏 container query 区间内，浮窗与宽停靠窗格显示同一布局。

浮出后停靠列显示该窗格的下一个页签（「文件」）是表面对所有浮出页签的通用行为——「已浮出」占位提示属于宿主层特性，本修复刻意不动它。dockkit 全局的 `FLOAT_MIN_SIZE`（220×140）仍约束手动拖拽缩放的下限；该下限是套件对所有窗格的约定，保持不变。

## 曾考虑的替代方案

- **抬高 dockkit 的默认值（`FLOAT_DEFAULT_SIZE`、`FLOAT_ORIGIN`）让所有窗格受益。** 否决：层叠默认是[停靠表面](../feature/2026-09-04-right-sidebar-docking-infrastructure.zh.md)对所有页签类型拖出浮窗的通用约定；按笔记面板的双栏需求定尺寸是把笔记专属诉求强加给其他窗格，且固定原点无法知道页签原来停靠的位置。
- **改面板的 container query 断点让双栏塞进 380px 窗口。** 否决：240px 的列表只剩约 140px 给详情，正是本修复要消除的不可读挤压；面板的断点按内容量定，保持不变。

## 后果

- 浮窗在视口至少 688×528 时以可读的 640×480 打开，小于该值时按比例收缩，且不再压住左侧边栏；`notes-face.client.spec.ts` 钉住了宽、窄、矮三种视口下的矩形计算，真机探针（Chromium 跑构建产物，1680×1000）实测恰好为 `{ x: 1016, y: 260, width: 640, height: 480 }` 且工具栏单行不折行。
- 手动把窗口拖窄到约 560px 以下时面板仍按设计落到单栏档。
- 浮出控件仍是笔记专属；其他页签仍按套件层叠默认拖出浮窗，行为不变。
