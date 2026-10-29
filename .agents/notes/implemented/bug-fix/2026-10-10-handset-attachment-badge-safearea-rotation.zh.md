# Agent Note: 手机端附件徽章与输入框触摸下限的冲突，以及旋转后的安全区重求值

Status: implemented

[English](2026-10-10-handset-attachment-badge-safearea-rotation.md) | 中文

## Problem

配对真机在两行顶栏构建（[手机端会话顶栏两行布局](../feature/2026-10-09-handset-session-header-two-rows.zh.md)）上暴露了两个仅限手机端的缺陷。其一，图片附件缩略图上的移除徽章渲染成一个大深灰圆圈，几乎占满 64px 的缩略图，看起来位置不对（"不居中"）；而徽章的规定尺寸是 18px，说明有规格之外的元素把它撑大了。其二，横屏转竖屏后，会话顶栏整块向下偏移了大约一个状态栏的高度并停在那里，浮动品牌按钮却不动；该偏移一直持续到重新加载。

## Decision

撑大徽章的是输入框的触摸下限，不是徽章本身。`InputBar.module.css` 中有 `@media (pointer: coarse) { .root button { min-height: 44px; min-width: 44px } }`（WCAG 2.5.5），而 `conversation.input.attachments` 插槽渲染在输入卡内、`.row` 之外，为停靠输入行写的手机端 28px 豁免盖不到它：手机上 18px 的徽章变成 44px 的圆，锚定在 64px 缩略图的 `top: 4px; right: 4px`，正是用户圈出的那种四边不对称、盖住缩略图的渲染。同一个下限还撑大了文件卡片的 18px 移除徽章、把上传失败时的行内重试文本按钮以 44px 最小值挤出 64px 卡片、并把附件栏 24px 的翻页箭头放大。ui-attachment 现在用两条类选择器（优先级高于 `.root button`）在 `(pointer: coarse)` 下为这套徽章控件单独豁免（`.rail .remove`、`.card .remove`、`.root .arrow`），保持绘制尺寸；每个徽章带一块透明的 `::after` 热区（18px 徽章 inset −13px，24px 箭头 inset −10px），在不视觉放大的前提下保住 44px 触摸目标；重试文本恢复自然行内尺寸。下限规则本身对 InputBar 自有控件不变，并加了交叉引用注释说明插槽豁免的位置。

旋转偏移是安全区插入值卡滞。`packages/client/web/src/base.css` 给 `#root` 设置了 `padding-top: env(safe-area-inset-top)`，这是应用里唯一的顶部偏移规则；而浮动品牌按钮是 `position: fixed`，天然免疫——因此浏览器在旋转后上报偏大的顶部插入值时，恰好只移动常规流装饰（顶栏），按钮不动，与截图完全一致。部分 Android WebView 在横屏转竖屏后会持续上报过期的 `env(safe-area-inset-top)`，直到有样式变化强制重新求值。`installBrowserCompat()`（`packages/client/web/src/compat.ts`，外壳的浏览器底座挂点）现在还会订阅 `orientationchange`，对 `#root` 重写一次行内内边距并强制回流后再清除，迫使引擎重新读取整个声明块；它会在随后两个动画帧各执行一次，并在 400ms 旋转动画预算后再执行一次；引擎本就已上报新值时它是无操作的。

## Alternatives considered

- **在源头（InputBar）把下限的作用域挪开插槽，而不是按徽章逐一豁免。** 已否决：下限对未知的插槽内容仍有价值；每个有规定绘制尺寸的徽章在拥有该设计的包内显式豁免，豁免就紧邻它保护的尺寸。
- **只恢复绘制尺寸、不加透明热区。** 已否决：这会回退下限所服务的 WCAG 2.5.5 目标；热区让绘制设计与 44px 级触摸面积兼得。
- **给内边距加上限（`padding-top: min(env(safe-area-inset-top), Npx)`）来挡住幻影插入值。** 暂时否决：上限必须低于真实的高插入值（安装到主屏的 iPhone Web 应用保留约 47–59px），任何数字要么裁掉真实插入值、要么容忍可见的幻影偏移；重求值在不用魔法数字的前提下修复了缓存类缺陷。如果真机验证发现受影响引擎是持续报错值而非缓存卡滞，再加入上限作为既定兜底。
- **监听 `visualViewport` 的 resize 而不是 `orientationchange`。** 暂时否决：该事件在键盘和工具栏几何变化时也会触发，每次聚焦都平添回流切换；`orientationchange` 直接点名了出问题的转换。

## Consequences

- `composer-touch-floor.client.spec.ts` 把豁免选择器与热区钉为 CSS 源码契约，与既有下限规则并存，下限的优先级变化无法再悄悄重新撑大徽章。
- `safe-area-resync.client.spec.ts`（jsdom）钉住了 orientationchange 重求值在帧回调与延迟回调上的行为、"不留行内样式"不变量，以及根节点缺失时的无操作分支。
- 真机验证待做：移除徽章量得 18px 且点击可用；受影响浏览器上横屏转竖屏后顶栏保持不动；若重求值不足以解决，以上述上限方案兜底。
- [手机端布局修复](2026-10-08-handset-device-layout-fixes.zh.md)中"44px 下限在其他所有粗指针场景仍然适用，包括 hero 卡片"的表述由本篇修正：卡片内的附件控件豁免，其余场景下限不变。
