# Agent Note: Closing verified reliability gaps in output reads, deletion, client lifecycle, projection, and framing

Status: implemented

[English](2026-10-11-verified-reliability-gaps.md) | 中文

## Problem

一份外部审计报告指出了本代码树中的十一处缺陷，分布在子进程输出路径、会话删除、SDK 客户端与协议、Workspace 客户端、会话投影、LSP 分帧，以及工具结果物化。每一处都在本树中重新核实；其中两处输出读取问题针对已发布代码复现，分帧与物化两处则做了量化测量：

- `OutputCollector.spillAll` 在流的 `data` 回调内打开并写入 spill 文件，因此那里的文件系统故障（磁盘写满、描述符耗尽、spill 目录被移除）会以未捕获异常逃逸，在命令结果被报告之前终结宿主进程。同一类别的其他 spill 失败此前都已被收敛。
- `readFrom` 按调用方偏移所落到的字节区间解码，因此跨两次读取被切开的多字节字符两侧都会被替换且不带标记：`中` 按 1+2 字节到达时读回一个替换符再加两个，`lossy` 仍为 false。`subprocess-e2b` 的读取器有相同缺陷。
- 递归删除先枚举 lineage、之后才预留计划成员，因此在 `sessionPersistence.list()` 挂起期间创建的子会话既没有被 `session/created` 守卫拒绝，也不在闭包中：父会话被删除、子会话存活，而调用仍报告成功。
- 重试把新发现的成员追加到持久计划末尾并按该数组顺序执行，因此在重试中被发现的后代会晚于其祖先被删除。
- `DeepSeekHarness.start()` 在等待 SDK 自有清理之前就清空了记忆化的握手，因此在那个 await 期间到来的调用者会在 `HarnessClient.close` 正在关闭的 client 上开始握手。
- `JsonRpcLineTransport` 不保存终止状态，也只监听输入端，因此输入结束后发出的请求会一直等待一个不可能到来的应答，异步输出失败也不会触达任何等待者。
- workspace 文件的跟随者只结算一次 ready promise，因此重连后的 `changes` 世代不会重新 stat，流消失期间发生的写入没有任何帧报告。
- `rename` 与 `insertSessionBefore` 在 await 之后无条件 upsert 其返回的一元回显，因此在该 Workspace 的 follow 世代增量之后才结算的响应会覆盖它——`updatedAt` 比较无法区分携带同一毫秒的投影。
- 投影的变更循环对每个监听器都不加保护，因此一个抛错的订阅者会跳过其后的订阅者，并让本次事件尚未到达的单元停止推进。
- `MessageDecoder` 把每个到达的分块拼接到累积缓冲区上：1 MB 的帧按 4 KiB 分块复制了 123 MB，8 MB 的帧约需 8 GB。
- 未注册内容 finalizer 时，`finishScheduledExecution` 会把已经物化过的同一结果再次物化；对一次 echo 调用的探针统计到三次完整的分离与冻结。

## Decision

每处缺口都在声明其所违反契约的地方关闭，且每个修复都带有在没有该修复时会失败的测试。

**子进程输出。** `OutputCollector` 对 spill 失败的收敛方式与它已有的关闭、unlink、超限失败相同：丢弃不可用的文件、不再公布 spill 路径，收集保留内存尾部。增量读取停在最后一个完整 UTF-8 字符处，`nextOffset` 指向它所返回文本的末尾，因此收到剩余字节的那次读取会整体返回该字符。两个提供方都用 `dsh-subprocess` 导出的 `readCompleteUtf8` 切出该边界——它与 `scrubbedParentEnv` 并列，都是普通函数导出——使该规则只有一个归属，并由各提供方的测试固定。

**会话删除。** 目标在第一次 await 之前就被预留，每一轮在重新枚举之前预留它已发现的成员；当某一轮没有发现新成员时计划即固定。预留作为一个集合统一释放，因此另一个删除所拥有的成员会被拒绝而不是被本次调用释放。清理顺序每次尝试都从该次尝试的 lineage 重新推导，叶子优先；而计划中的成员数组保持其顺序作为报告的删除集合；不再持久存在的成员最后清理。

**SDK 生命周期。** `start()` 只在清理与 client 替换完成后才清空其记忆化握手，因此清理期间到来的调用者会等待同一次操作。传输层只保留一个终止原因——来自 `close()`、输入 end 或 error、以及输出 error（输出监听器由 `start()` 挂接、由 `close()` 移除）——它让挂起请求失败、让之后的请求以该原因被拒绝而不是保持挂起，并丢弃通知。

**Workspace 客户端。** 已经确认过 ready 的跟随者会为之后每次 ready 排入一条 resync 通知，提供方用一次新的 stat 回应它；未绑定到 Host 路径的通知会通过跟随者的路径过滤。`rename` 与 `insertSessionBefore` 仅在没有任何流帧到达时才应用其回显，这也是该模型中 list、archive 与 order 响应早已采用的同一竞态解法。

**会话投影。** 每个变更监听器都在各自的 try/catch 中运行，失败会带单元 key 记录，符合 `docs/defensive-patterns.md` 对分发器的要求。

**分帧与物化。** `MessageDecoder` 以待处理字节到达时的分段保存它们，逐段并用前一段的末尾字节搜索分隔符，只拼接它正在读取的那一帧。当内容 finalizer 原样返回时，`finishScheduledExecution` 复用它已经物化过的候选结果。

## Alternatives considered

- **让调用方处理 spill 失败而不是收敛它。** 拒绝：该失败发生在流回调内部，所谓"调用方"就是宿主进程，而该收集器自身的关闭、unlink 与超限路径本就退化为内存尾部。
- **通过重新读取 spill 文件来保留不完整字符。** 拒绝：保留尾部已在内存中，在边界处恢复的读取不需要文件。
- **让每个提供方各自持有一份读取边界实现。** 拒绝：该规则属于 `dsh-subprocess` 中的读取器契约，两份字节区间扫描会漂移；`pnpm run duplication` 也会把这份克隆判为重复。
- **对抛错的投影监听器直接报错而不是收敛。** 拒绝：一个订阅者的缺陷不应阻止已提交事件仍需到达的单元，而发出该事件的会话追加路径本就以同样方式收敛观察者失败。
- **为 Workspace 投影增加 Host 侧单调 revision。** 暂缓：这要同时改动线上类型与两端；世代仲裁已经消除了可能竞争路径上的同毫秒覆盖，而流自身的 `updatedAt` 守卫仍会拒绝乱序帧。
- **让分帧解码器按头部长度一次性预分配缓冲。** 拒绝：头部完整之前长度未知，分段形式无需预分配猜测。

## Consequences

- 无法写入的 spill 现在静默退化为内存尾部而不是明确报错；`lossy`/`truncated` 仍描述保留窗口，被扣留的 spill 路径就是"没有完整流恢复文件"这一事实对调用方的信号。
- 当多字节字符仍在到达时，一次读取可能返回空文本且 `nextOffset` 不变；消费方直接赋值 `nextOffset`，因此下一次读取会正确恢复。
- 在整个预留窗口内（包括此前会竞争的那次枚举 await）都会拒绝创建子 agent。在预留之前开始、并在最后一轮之后才提交的创建仍可能逃逸——该守卫是进程内事件监听器，无法覆盖另一个进程。
- 对不再持久存在的成员，其 Workspace 注销现在发生在活跃 lineage 之后；`deletion.spec.ts` 记录了新的顺序，而报告的 `deletedSessionIds` 不变。
- 在失败握手清理期间到来的 `start()` 调用者现在共享该失败，而不是发起自己的尝试；重试是之后在新 client 上的下一次调用。
- 传输终止后发出的请求会以终止原因被拒绝而不是等待；自行安装 `output` 错误处理的消费方仍会收到该事件，终止后的 `notify` 被丢弃。
- 重连一次 `changes` 世代会对每个已打开文件多做一次 `stat`，而两次世代之间的 `resize` 现在即使没有任何帧报告也会被观察到。
- 每次工具调用的 `materializeFinalResult` 从三次降为两次；post-execute 之前的候选快照与提交结果仍是两次独立的物化。
- 未为被审计的各子系统另建 Agent Note：本批次共享同一个起因（对该代码树的一次审计）与同一套验证方式（每处缺口一个会失败的测试）。
