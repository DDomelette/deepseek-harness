# Agent Note: 客户端领域图门禁以基线做棘轮收敛

Status: implemented

[English](2026-10-19-client-domain-graph-ratchet.md) | 中文

## 问题

`scripts/verify-client-domain-graph.ts` 把守 `packages/client/*/src/client/` 的分层规则：领域目录绝不 import 兄弟领域，`contract/` 是唯一的共享层，只有 `apply.ts`/`index.ts` 可以跨领域装配（见 [Web 客户端架构笔记](../architecture/2026-07-19-gui-web-client-architecture.zh.md)）。在落地本决策的代码树上，该门禁每次运行都报告 83 个说明符并以 1 退出——其中 54 个是兄弟领域 import，26 个来自顶层非装配文件——分布在 `ui-sidebar-documentpreview`（38）、`ui-sidebar-browser`（19）、`ui-settings-account`（15）、`ui-workspace`（4）、`ui-conversation`（3）和 `ui-chat`（1）。`scripts/run-gates.ts` 只在本地 `check-all` 聚合里登记它，而没有任何 CI 作业运行该聚合，因此没有任何一条通道看到过它的退出码。无人运行的检查不携带信号：违规数量增加或减少都不会被评审者发现，而要让检查重新生效，必须先清理全部 83 处 import。

这 83 个说明符对应 80 条不同的违规，因为 `ui-sidebar-documentpreview/src/client/TextPreview.tsx` 一共五次 import 了两个兄弟领域说明符：三次 `./text/lines.ts`，两次 `./document/registry.ts`。因此门禁打印的数量和它保存的基线都必须区分"出现次数"与"标识"。

## 决策

门禁以"对照入库存基线"的方式收紧（棘轮），而不是要求绝对干净。`scripts/client-domain-graph.baseline.json` 记录了作出本决策时代码树中存在的每一条违规；运行时，凡是基线与本次发现无法对上的情况都判失败——出现基线之外的违规判失败，基线条目不再复现也判失败——只有完全一致才以 0 退出。于是记录集合只能被有意缩小，无法悄悄变大，这也保持了[质量门禁笔记](2026-06-11-quality-gates.zh.md)的规则：每个可机械检查的承诺都有一个以非零退出的命令。

发现逻辑是语法感知的。每个客户端源码都用 TypeScript 解析器解析，因此 import 声明、re-export、`import = require(...)` 和动态 `import()` 都计入，注释或字符串里的说明符绝不计入，重新格式化文件也不会改变结果。在落地本决策的代码树上，解析得到的集合与先前 `from '...'` 正则集合完全一致，零新增、零减少，因此纳入基线既没有漏掉违规，也没有多报违规。当发现的客户端源码少于 500 个文件时，发现阶段同样判失败，与相邻的客户端门禁一致，因此被裁剪过的检出无法报告一个干净的门禁。

`pnpm exec tsx scripts/verify-client-domain-graph.ts --write`（别名 `--update-baseline`）按当前代码树重写基线并以 0 退出。脚本顶部 JSDoc、[Web 客户端规则](../../../../packages/client/AGENTS.md)以及落地该棘轮的提交信息都记录了这个命令。

`ciSharedStaticGates()` 登记了该门禁，因此 `ci-primary`、`ci-static` 和 Windows 观测通道会在 `client-packages` 与 `client-ui-i18n` 旁边运行它；本地 `check-all` 聚合保留原有登记。

## 基线标识与失效检测

一个条目由仓库相对的 importer 路径加被 import 的说明符组成，两者都用 `/` 分隔，排序依据先是 importer，再是说明符。行号和列号被刻意排除：标识必须在与该 import 无关的编辑（例如同一文件内移动该 import）之后依然成立，否则每次重新格式化都会让基线失效，棘轮就退化成反复的维护工作。条目按该标识去重，因此入库文件对 83 个说明符只保存 80 个条目，同一文件里重复 import 同一个说明符也不需要第二条。

过期条目判失败，而不是只给警告。若只警告，违规数量的减少就永远不会迫使文件缩小：基线会保留不再复现的标识，被接受的计数不再描述代码树，而下一次真正的增长可能混在过期条目里无人察觉。双向都判失败，才使这个文件始终是"已接受债务"的真实清单。

## 考虑过的替代方案

**立刻清理全部 83 处违规。** 否决，因为它们不造成用户可见的缺陷，也不打断任何产品路径。要修就得把共享的 CSS modules 与 store 辅助模块搬进各包的 `contract/`，这是分散在多个客户端包里的大改动，并带有视觉回归风险——后者只有浏览器快照通道能定价。先让规则生效、再单独偿还债务，两件事都更容易评审。

**让门禁继续红着，且不接入 CI。** 否决，因为正是这种状态造成了 83 这个数字。没有任何东西读取它的退出码，它抓不到下一处违规，其计数也没有归属者。

**把门禁接入 CI 并保持红色。** 否决，因为一条在无人改动的代码上就失败的必需通道，会阻塞每一处不相关的改动，直到清理落地，这与门禁本要避免的中断正好相反。

**按文件与行号建立基线。** 否决，因为只要在 import 上方插入任何编辑，行号就会移动，基线会因与分层规则无关的原因失败，重生成频率将远高于违规真实变化频率。

**把过期条目当作信息报告并通过。** 否决，理由见上一节：文件会在没有任何门禁失败的情况下过期失真，缩小它要依赖有人记得执行 `--write`。

## 影响

任何修复、移动或移除基线内 import 的改动，都会让门禁变红，直到执行 `pnpm exec tsx scripts/verify-client-domain-graph.ts --write` 重新生成基线；这次重生成属于该修复所在的那次改动。这是有意为之：债务正是靠它缩小。新增一处跨兄弟领域的 import 会立刻失败，也包括先前的正则表达式看不到的副作用 CSS import。

这条门禁对静态通道足够廉价：在落地本决策的 Windows 主机上，它处理 773 个客户端源码文件耗时 2.6-3.2 秒（经 `pnpm run` 这条 gate runner 入口是 3.2 秒）。

两个方向都已在基线入库的前提下验证。门禁打印 `773 Client source file(s) match the 80 accepted violation(s).` 并以 0 退出；在 `ui-workspace/src/client/session-actions/` 下放置一个 import `../rows/Rows.module.css` 的临时文件后，它以 1 退出并精确指出 `packages/client/ui-workspace/src/client/session-actions/RatchetScratch.ts -> ../rows/Rows.module.css`；删除该临时文件后门禁重新以 0 退出。`scripts/verify-client-domain-graph.spec.ts` 固定了每一种被接纳与被排除的 import 形式、棘轮的两个方向、`--write` 流程、语料下限，以及未知参数拒绝。

基线记录的是已接受的债务，而不是"哪些 import 合法"的判决。缩小它是常规工作：修掉一处违规，执行 `--write`，把变小的文件与修复一起提交。当不再有违规时，文件里的 `entries` 是空数组；此时直接删除该文件同样通过，因为缺失的基线被读作空基线。
