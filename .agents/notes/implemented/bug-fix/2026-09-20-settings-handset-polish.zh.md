# Agent Note: 设置详情窗格的手持端打磨

Status: implemented

[English](2026-09-20-settings-handset-polish.md) | 中文

## 问题

[单栏手持设置外壳](../feature/2026-09-13-settings-single-pane-handset.zh.md)把设置面板统一到一个断点（`SETTINGS_PANE_BREAKPOINT = 768`、`data-pane="list|detail"`），但详情窗格的三处布局只在桌面面板上量过。在 390×844 触屏仿真下：

- 详情页顶栏一行挤着返回箭头、分区标题、「打开配置文件」药丸按钮和关闭按钮；药丸约占三分之一宽，把分区标题挤到了返回键旁边。
- Appearance 偏好的三张通宽卡片（`flex: 1 1 180px` 带换行）竖向堆成约 300px 高。
- Permission 行把标题与描述挤进选择器旁约 150px 的列里，说明文字一字一行地换行。

## 决策

三处修复都收在各属主样式表的 `@media (max-width: 767px)` 内，与外壳发布的是同一个断点；双栏布局逐像素不变。这些行只在设置面板内渲染，因此裸媒体查询就是正确的闸门（list 窗格本来就不会绘制分区内容）。

- `SettingsDocumentAction` 把该操作留在每个分区的顶栏，但在单栏态折叠为纯图标按钮（`IconCodeOutline16`）：按钮现在带 `aria-label={t('openDocument')}`，标签渲染在一个 span 里——媒体查询隐藏它并显示图标。该操作打开的是整个 cordis.yml 文档，并非 General 分区专属，因此它留在共享顶栏而不是挪进某个分区的内容区。
- `AppearanceRow.module.css` 把卡片行改为三个紧凑的等宽段（`flex: 1 1 0`、不换行、10px 纵向内边距、12px 圆角、13px 标签）。选中态视觉与 `aria-pressed` 语义不变。
- `PermissionRow.module.css` 让该行换行：文字占 `flex: 1 1 100%`（48px 的选择器预留取消），选择器移到下一行、左对齐。字号行共用同一种行结构，但其步进器够小、描述并未受挤压，因此保持原样。

## 曾考虑的替代方案

- **把打开文档操作挪进 General 分区作为内容行。** 否决：该操作注册在 root 作用域的 `settings.action` 列表槽上、出现在每个分区的顶栏，因为它打开的文档是全局的；把它塞进 General 会在手持端对其他分区隐藏它，而且同一个 store 还得再注册一个槽位。
- **让单栏顶栏换成两行。** 否决：外壳的 grid 给这条栏固定的 60px 行高，为一个低频操作加高栏体会吃掉每个详情窗格的纵向空间；纯图标处理与 rail 和 composer 既有的图标按钮模式一致。
- **字号行照 Permission 行同样处理。** 判为不需要：其步进器约 80px，描述列仍然可读；没有实测缺陷的改动只是扰动。

## 后果

- 390×844 下详情页顶栏一行放得下、标题可读；Appearance 选择只占一个紧凑行；Permission 描述以通栏散文呈现，选择器在其下方。
- 桌面（>767px）每个像素都不变：图标座位是 `display: none`，两个行的样式表也只在媒体查询内变化。
- `apps/web/tests/settings-mobile.e2e.ts` 量测手持端详情窗格：纯图标的文档操作保留可访问名称、三个外观选项同处一行（y 相同）、Permission 选择器位于描述之下；桌面测试守护带标签的药丸按钮。
