# Agent Note: 笔记面板的原语收敛与清理

Status: implemented

[English](2026-09-21-notes-primitives-cleanup.md) | 中文

## 问题

一次设计走查发现笔记面板有三类漂移：无人渲染的死样式、ui-primitives 已有配方的手写拷贝、以及若干几何小缺陷。

- `NotesPanel.module.css` 带着素材列表样式的完整第二份拷贝（`.list` 到 `.rowSource`),`MaterialList.tsx` 从不读取——而且这份拷贝悄悄弄坏了一条活规则：单栏档的 `.panel[data-notes-selected] .list { display: none }` 指向的是本模块的 `.list`，没有任何元素携带这个类，因此低于 560px 时打开的详情与列表挤在一起而不是取而代之。
- 工具按钮配方（tool-bar 底 + 0.5px 边框 + 圆角 + hover）被手写拷贝到行手柄、定位控件和详情的五个操作按钮；主按钮配方也存在两份（空态新建、追问发送）。
- 列表列在任意面板宽度下都是固定的 240px；双栏而未选中素材时详情一侧一片空白。

## 决策

清理保留所有 `data-notes-*` 钩子与可见行为，除非另有说明：

- 死 CSS 在 grep 确认零引用后删除：NotesPanel 的列表块，以及 `NotesSettingsCard.module.css` 的 `.actions`/`.actionRow`（已不存在的只读动作列表残留）。单栏隐藏规则改为选择 `[data-notes-materials]` / `[data-notes-detail]`——属性选择器不受 CSS Modules 作用域影响；列表通宽覆盖挪进 `MaterialList.module.css`，即 `.list` 真正所在的模块。真机探针确认修复：544px 面板下打开详情会隐藏列表。
- 行归档手柄、定位控件、详情操作按钮改用 ui-primitives `Button`(`sm`、`outline`)；空态新建与追问发送用 `Button` `primary`(`md` 与 `sm`)。手柄保留 PR #56 的座位结构——行内 flex 槽位、按行 hover/focus 切换 `visibility`——以一个只持有座位的小类挂在共享 Button 上；设置卡自己的配方拷贝留给设置卡专项治理，不在本 PR 范围。`.addFeature` 补上其 flex 列分区所需的 `align-self: flex-start`，是该处唯一顺带修复。
- 列表列宽改为 `clamp(220px, 32%, 340px)` 弹性；双栏档以下仍独占整栏。
- 未选中素材时，详情一侧显示引导空态（图标 + 一行本地化文案 `detail.empty`)，在单栏档隐藏（那里只显示列表）。
- 杂项：状态圆点用 `border-radius: 50%` + `corner-shape: round` 取代 8px 方圆角；`panel.restore` 中文改为「取回置顶」，与英文 "Restore to top" 对齐。会话标题栏角落的笔记按钮刻意保留 15px 图标：该座位的惯例（ExpandButton 与侧栏自带控件）就是 28px 圆内 15px 字形，单独改一个控件会破坏整排的节奏。

## 曾考虑的替代方案

- **单栏规则留在 `NotesPanel.module.css` 继续用作用域类名。** 否决：规则正是这样烂掉的——作用域 `.list` 悄悄匹配不到任何元素。属性选择器指向元素真正携带的东西。
- **单栏隐藏修复单独开一个 PR。** 否决：修复与删除导致它的死代码块是同一批行，不可分。
- **给 `Button` 加一个带边框的 toolbar 变体以逐像素复刻旧配方。** 否决：`outline` 就是产品的带边框惯例（SettingsDocumentAction)；保留手写外观等于没收敛。

## 后果

- 约 120 行死或重复的 CSS 离开包；按钮配方只存在一份（ui-primitives)。
- 单栏档在打开详情时真正隐藏列表——一次随清理上车的行为修复，已在 Chromium 544px 下验证。
- `notes-refresh` Web e2e 黄金文件无需变更：Button 替换后 ARIA 角色与名称完全一致。
- 包内 401 个测试全绿，改动源文件保持 100% 覆盖；空态在 `notes-panel.client.spec.tsx` 中有断言。
