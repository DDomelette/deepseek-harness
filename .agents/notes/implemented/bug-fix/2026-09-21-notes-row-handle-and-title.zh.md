# Agent Note: 笔记列表行手柄与会话标题的可读性

Status: implemented

[English](2026-09-21-notes-row-handle-and-title.md) | 中文

## 问题

笔记面板（`packages/notes/notes/src/client/`）有两个实测缺陷：

- 素材行的归档手柄是 `position: absolute; right: 4px; display: none`，仅由 `.row:hover` 显现。它直接压在行内的来源标签上（实测重叠 22×15px），且 `display: none` 无法被键盘聚焦，手柄永远无法通过焦点显现或获得焦点。
- 导航栏的会话触发器带着 `min-width: 0`，旁边是六个 `flex: none` 的工具按钮，flex 收缩时它先被压垮：标题渲染为「笔记 ·」即被切断（实测按钮宽 45px，内容宽 72px）。标题文字位于匿名 flex 项中，ellipsis 也无法生效。

## 决策

`MaterialList.module.css` 把手柄挪进行自身的 flex 流（`flex: none; margin-right: 4px`），并改用 `visibility` 而非 `display` 切换：座位始终预留，显现时既不遮挡内容也不引起布局移动。显现选择器为 `.row:hover` 与 `.row:focus-within`，手柄获得共享的 `:focus-visible` 指示（2px `--dsw-alias-brand-primary` outline，与 ui-primitives 的 Switch 一致）。行拖拽与 drop 指示线不受影响：`<li>` 保持 `draggable`，指示线仍是行上的 `box-shadow`。

`NotesPanel.tsx` 把会话标题包进一个持有 ellipsis 的 `conversationTitle` span（`overflow: hidden; min-width: 0; text-overflow: ellipsis; white-space: nowrap`），`NotesPanel.module.css` 给触发器 `flex: 0 1 auto; min-width: 10em`——约 8 个中文字符的标题在 ellipsis 前保持可读——并保留 `max-width: 60%` 作为宽面板下的上限。工具按钮标签的 container query 从 499px 移到既有的 559px 单栏切换断点，使 500–559px 区间（带标签的工具按钮加上标题下限）不会撑出导航栏；低于 560px 面板只显示一栏，同一组控件只带图标。

## 曾考虑的替代方案

- **手柄保持绝对定位，给行按钮预留右侧内边距。** 否决：预留宽度必须猜手柄的宽度，而手柄宽度随语言变化（「归档」与「Archive」）；行内 flex 座位自适应。
- **对行内手柄切换 `display`。** 否决：出现与消失会让行内文字在每次悬停时重排——这正是本修复要消除的抖动。
- **低于 560px 时让导航栏换行而不是隐藏标签。** 否决：两行栏体会吃掉每个窄面板的纵向空间，且纯图标处理已作为 ≤499px 的既有行为存在——把它扩展到单栏区间是复用已发布的模式，而不是新增第三种布局。

## 后果

- 手柄不再遮挡行内容，键盘聚焦与悬停都会显现，并有可见的焦点框；每一行永久预留手柄宽度，因此标题会略早一点 ellipsis。
- 会话标题在任意面板宽度下至少保留约 8 个字符，超出后正确 ellipsis；500–559px 区间显示纯图标工具按钮，导航栏不再溢出。
- `packages/notes/notes/tests/notes-list.client.spec.tsx` 与 `notes-panel.client.spec.tsx`（63 个测试）原样通过——它们断言 `data-notes-*` 钩子与本地化文案而非 CSS 类——因此无需更新选择器或黄金文件。
