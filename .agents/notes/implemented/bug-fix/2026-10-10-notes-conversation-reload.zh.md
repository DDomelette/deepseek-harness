# Agent Note: 重新载入已记录的笔记会话

Status: implemented

[English](2026-10-10-notes-conversation-reload.md) | 中文

## Problem

一条笔记会话是一条持久记录加一条真实 dsh Session，但 `Analysis.targetFor` 通过 `ctx.agents.get` 解析它的 Agent，而那里只有活的 Agent。因此 `dsh web` 进程一旦重启，每条已记录的会话就都没有 Agent：`analyse` 与 `ask` 回报 `session-not-live`，已提交素材的对话读取同样如此，而面板给出的唯一建议是"需要重新打开"——一件面板自己做不到的事。草稿的对话读取也以同样方式失败，于是一条从未进入会话的素材在应当显示"还没有提交给模型"的位置显示了会话存活性的报错。

在实际报告的部署上实测：活动笔记记录点名 Session `cd1079a4-ecf1-453c-8813-bca536124e7b`，写于 2026-09-16，而正在服务的 `dsh web` 进程启动于 2026-10-10。该 Session 日志完好、记录也在列表里，但当天收集的素材点「分析」什么也提交不出去。

## Decision

已记录的会话按需载入。本进程持有 Agent 时，`NoteSessions.liveAgent(record)` 返回 `ctx.agents.get(record.sessionId)`；否则通过 `ctx.agents.resume` 把已记录的 Session 重新载入。载入由 `create` 使用的同一个私有 `composition()` 组装——部署的 preset 名册（若有）与笔记设置节的模型路由或部署默认值——因此重新载入的会话运行在"现在新建一个会话会运行的东西"上。载入得到的 Agent 与新建的一样归笔记服务的 fiber 所有，卸载时随之释放。

同一 Session 的载入是单飞的。Session 的持久化只允许一个写者，因此并发的第二次载入会被拒绝而不是被服务；同时到达的调用共享第一个的 promise。载入结算时该项即离开映射，因此失败永远不会被记成答案，下一次调用会重试。

无法发生的载入会被报告而不是抛出。`Analysis.targetFor` 仍是把会话变成 Agent 的唯一位置，当 `liveAgent` 拿不到东西时它回答 `session-not-live`；原因——日志已消失或读不出来、部署没有挂载 session persistence、另一个进程持有写租约，或 preset 名册无法组装——记入日志供运维查看。该失败码对应的面板文案现在是「这个笔记会话无法恢复运行，请新建一个会话继续。」，因为需要重新打开它的已经不是读者。

`Analysis.thread` 对从未进入会话的素材在解析任何 Agent **之前**就回答空行：草稿没有东西可读，而一条什么都没收到过的会话不该为了说这句话被启动。对已提交的情形，`thread` 与 `NotesRemote.materialThread` 都是异步的，它们先解析——并可能载入——自己的会话。`Analysis` 不再注入 `agents`，改为通过 `ctx.notesSessions` 抵达注册表。

## Alternatives considered

- **通过 API 的 session controller 重新打开 Session。** 否决：那个 controller 是 Remote BFF，产品插件向上伸手会颠倒分层；这些 Session 由笔记插件创建、其组合也由笔记拥有，因此"再次载入一个"应当待在 `create` 旁边。
- **保留这条拒绝，另加一个"到会话列表中打开它"的控件。** 否决：宿主本来就知道怎么载入一条已记录的 Session，而这个绕行会让面板自己的操作在读者走完它之前一直失败——同时仍会对一条宿主根本没尝试载入的会话回报 `session-not-live`。
- **不经过 Agent，直接从持久化读取已提交素材的对话。** 否决：这需要在活的日志投影之外再开一条读取路径（`ctx.sessionQuery`），而 `analyse` 与 `ask` 仍然必须载入该会话；保持单一解析点才能让面板显示的内容与模型看到的一致。
- **先认领素材，再解析它的会话。** 这能保住"同一 tick 内编辑与分析"的既有顺序，但它会让素材为一条可能根本载入不了的会话被标记成 `analyzing`，而回滚这次认领又只能用发送自己的词汇去报告一次会话失败。
- **持有返回的 `AgentHandle`，并在空闲时释放会话。** 否决：读者真正打开过的会话才会被载入，数量有限，而服务的 fiber 已经通过 resume 上下文持有它们。

## Consequences

- `tests/conversation-resume.host.spec.ts` 钉住载入本身：持有活 Agent 时不载入、按记录点名的 Session id 重新载入、载入的会话按新建会话的同一组合组装（模型路由与 preset 挂载）、同时到达的调用只载入一次、载入失败时什么都不返回，以及失败之后下一次调用会重试。
- `tests/analysis.host.spec.ts` 对"本进程不再持有"的会话做分析、追问与对话读取，原先的 not-live 用例改为脚本化一次失败的载入；`tests/remote.host.spec.ts` 在 wire 命名空间上覆盖同一路径；`tests/notes-composition.host.spec.ts`——本包要求的真实 Loader 组合——分析一条本进程不再持有的会话里的素材。
- `tests/submission-races.host.spec.ts` 记录这次顺序变化：同一 tick 内的分析不再先于兄弟编辑抵达素材的写队列，因为它要先解析自己的会话。落在这个窗口里的编辑会提供被提交的正文，已经认领素材的分析会拒绝其后的编辑，而自身写入输掉这场竞争的那次编辑会收到 `material-submitted` 拒绝。
- 包 README（两种语言）把"A notes conversation must be live"这条限制换成了"Session 无法载入的会话会被拒绝"，并在 **What to expect** 与 **Submission** 两节写明这次载入；两本字典带上新的拒绝文案。
- 不新增 recorded-session 场景：重新载入一条会话不改变任何模型可见的 transcript，面板的覆盖仍留在本包自己的 host 与 client 用例里。
- [笔记插件笔记](../feature/2026-09-11-web-notes-plugin.zh.md) 声称重启过的进程会一直回报 `session-not-live` 直到会话被重新打开；该事实已在那里订正，并指向本笔记作为载入决策的归属。
