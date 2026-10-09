# Agent Note: 手机端转录滚动条：以对称槽位恢复

Status: implemented

[English](2026-10-09-handset-transcript-scrollbar-both-edges.md) | 中文

## Problem

[手机端真机修复](../bug-fix/2026-10-08-handset-device-layout-fixes.zh.md)在手机区间隐藏了转录滚动条：配对设备的浏览器使用占用布局的经典滚动条，无条件的 `scrollbar-gutter: stable` 保留让居中内容列向左偏离半个保留宽度。隐藏修复了居中，但也完全移除了滚动指示——没有位置提示，也没有拖拽目标——用户要求把滚动条加回来，同时不破坏居中。

## Decision

手机区间保留滚动条，并对称预留槽位：`[data-sidebar-fab] .scrollBody { margin-right: 0; scrollbar-gutter: stable both-edges }`。在经典滚动条引擎上，左侧槽位镜像滚动条宽度，内容盒保持对称，居中列保持视口中心；在叠加式滚动条引擎（手机的常见情形）上滚动条不占布局、槽位不做预留，因此无任何偏移。用 `stable`（而非裸 `both-edges`）使预留恒定，转录开始溢出时列不会跳动。2px 滚动条偏移在此区间仍然去掉，叠层 composer 的滚动容器保留自己的 `scrollbar-gutter: auto`（源码顺序在后的同优先级规则）与手机端座位补偿——该盒子从不滚动，因此从不承载滚动条。ui-chat 的 TurnNavigator 浮层滚动容器保持隐藏滚动条：悬浮式导航层没有需要保护的居中列，也没有容纳槽位的空间。

## Alternatives considered

- **保持隐藏滚动条**（真机修复笔记的立场）。被用户的指示取代：滚动指示需要恢复，而对称槽位消除了当初隐藏所依据的居中代价。
- **显示滚动条并手工计算左侧补偿**（`scrollbar-width: thin` 加等量左外边距）。否决：滚动条宽度因引擎而异（WebKit 的 `::-webkit-scrollbar` 宽度由作者控制，Firefox 的 `thin` 不可控），补偿无法保持精确；`both-edges` 按引擎自身宽度预留，天然精确。
- **滚动时浮现的自定义悬浮滚动条**（JS 驱动的指示条或第三方库）。否决：它最接近原生手机体验，但意味着自维护的滚动监听与自动隐藏逻辑——或新增依赖——去换一个引擎本就提供的指示。

## Consequences

- 手机区间的经典滚动条平台上，转录区恢复可见滚动条，代价是左侧一条对称空带（两侧各一个条宽）；叠加式平台与此前的像素完全一致。
- mobile-drawer e2e 的计算样式断言随行为同步（`stable both-edges` / `auto`）；composer-tab-geometry lane 不受影响（其窄视口仍在叠层断点之上）。
- 本条逆转了 [手机端真机修复](../bug-fix/2026-10-08-handset-device-layout-fixes.zh.md) 的一个要点（隐藏滚动条、去掉槽位）；该笔记的已落地事实句指向本条。[Composer 标签页槽位保留](../../archived/bug-fix/2026-08-04-composer-tab-gutter-reservation.md) 的桌面 `scrollbar-gutter: stable` 保留不受影响。

## Related

- [手机端真机修复](../bug-fix/2026-10-08-handset-device-layout-fixes.zh.md)——本条部分逆转的隐藏决策。
- [手机端 Session 头部：两行标题布局](../feature/2026-10-09-handset-session-header-two-rows.zh.md)——同一轮迭代中的同类手机区间改动。
