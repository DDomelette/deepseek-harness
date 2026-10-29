# Agent Note：Modal bodyClassName 固定配对弹窗头部

Status: implemented

[English](2026-10-02-modal-body-classname-pinned-header.md) | 中文

## 问题

配对面板在小窗口下会超出高度，因此「连接手机」弹窗限制高度并滚动。此前的滚动区是 Modal 的整个内容列，其中包含标题、描述与关闭按钮——滑到底部时头部被一起带走，操作者再也够不到 ✕ 来关闭弹窗。

## 决策

`Modal` 新增可选 `bodyClassName`，施加在它的 body 容器上，调用方因此可以把 body——而不是整个内容列——指定为滚动区。「连接手机」弹窗照旧限制高度，内容列保持可收缩（`min-height: 0`），把 `overflow-y: auto` 移到 body；标题与描述在任何滚动位置都保持可见。该 prop 是加性改动：现有三个 `contentClassName` 使用方不受影响。

## 考虑过但未采用的方案

- **在滚动的内容列内对头部用 `position: sticky`。** 否决：sticky 头部仍会随带内边距的列一起布局，且要把描述行一并钉住需要 `:nth-child` 这类结构兄弟选择器，Modal 的 markup 一变就碎。
- **在配对面板内部滚动。** 否决：面板不应知道自己身处 Modal 之中；高度上限归弹窗外壳所有。

## 影响

- 任何 Modal 调用方都能以同样方式固定外壳；只传 `contentClassName` 的弹窗行为与之前完全一致。
- 即使在最高的面板（二维码 + 请求 + 设备 + 回收站）底部，配对弹窗的 ✕ 与标题仍然可达。
