# Agent Note: 笔记详情页的区块分层

Status: implemented

[English](2026-09-21-notes-detail-sections.md) | 中文

## 问题

素材详情页把来源条、动作模板、正文、状态与操作行、对话线程堆成一栏无区分度的左对齐文字：没有分区标题、没有容器边界，模板标签用着阶梯外的 10px 字号，状态字与操作按钮混在一行基线不齐。读者要费力分辨正文到哪里结束、回答从哪里开始——而这正是详情页应当省掉的力气。

## 决策

详情页改为带标题的分区——来源、动作模板、素材正文、对话——每个分区一个小字标题（`--dsw-font-xxs-12`、`--dsw-alias-label-tertiary`）盖在内容之上（`MaterialDetail.tsx`、`MaterialDetail.module.css`)。全区统一一种视觉语言：平面分区，需要边界的内容用 0.5px 发丝边框（`--dsw-alias-border-l2`）容器；面板内不用任何 elevation 阴影。

- 动作模板卡默认折叠为提示词首行（`aria-expanded="false"` 下的 `line-clamp`），整张卡是一个按钮、点击展开全文；阶梯外的 10px 标签消失，页面内所有字号都走 `--dsw-font-*` 阶梯。
- 已提交正文放在发丝边框卡片上；草稿编辑器保留自己的带框编辑框；截图素材保留一行占位说明。
- 状态字改为左侧的 quiet `Tag`，操作按钮归为右对齐的一组。
- 线程行遵循会话区自己的惯例（ui-chat `MessageItem`)：读者一侧是 `--dsw-specific-bubble` 气泡（圆角 22、padding 10px 16px)，模型一侧是平面排版。

本次改动纯表现层：没有移动任何 `data-notes-*` 钩子、remote 调用或 model-visible 数据；刷新后的 ARIA 黄金文件（`apps/web/tests/expected/notes-refresh/settled.expected.md`）显示 DOM 可观测的差异只有三个分区标题。新增文案（`detail.section.source`、`detail.section.thread`、`detail.templateExpand`、`detail.templateCollapse`）中英双语齐备。

## 曾考虑的替代方案

- **每个分区用抬升卡片（`--dsw-elevation-*`)。** 否决：web-styling 禁止发丝边框与 elevation 阴影混用于同一种表面语言，且面板本身已在抬升的 layer-1 底板上——内部再叠 elevation 是噪音而不是结构。
- **用截断字符串的方式折叠模板。** 否决：在 DOM 里裁掉文本会让已记录的提示词无法被搜索，也会破坏「卡片携带完整提示词」的既有断言；`line-clamp` 只做视觉折叠，文本保持完整。
- **分区标题带编号或图标。** 否决：会话、设置、侧栏表面都用裸的 tertiary 小标题；为一个面板发明第二种标题语法会破坏产品的视觉语法。

## 后果

- 详情页一眼读出四个带标题的区块；模板只占一行、按需展开；状态与操作不再共享基线。
- `notes-detail.client.spec.tsx` 新增折叠/展开行为测试；包内 401 个测试全绿，`MaterialDetail.tsx` 保持 100% 覆盖。构建产物的浏览器截图（折叠与展开两态）端到端验证了分区布局。
- `notes-refresh` Web e2e 黄金文件因有意新增的标题而刷新，回放通过。
