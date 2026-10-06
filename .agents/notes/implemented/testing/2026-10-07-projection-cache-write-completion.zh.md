# Agent Note：投影缓存检查点上报写入完成

Status: implemented

[English](2026-10-07-projection-cache-write-completion.md) | 中文

## 问题

session-projection-cache 的两个测试套件都用字面量 `vi.waitFor` 轮询存储文档来观察持久化结果：[`cache.spec.ts`](../../../../packages/session/session-projection-cache/tests/cache.spec.ts) 用 `5_000`，[`fixtures.spec.ts`](../../../../packages/session/session-projection-cache/tests/fixtures.spec.ts) 用 `REWRITE_GUARD_MS = 30_000`。Windows coverage 车道给每个用例 90 秒预算，但 `vi.waitFor` 只接受调用点的字面量，因此这些死线远低于车道预算。在 fork 车道的超卖条件下——4 vCPU、两个插桩分区、外加第二个 gate——写穿透的尾延迟越过了它们：[issue #73](https://github.com/DDomelette/deepseek-harness/issues/73) 记录了 30 秒 guard 被耗满至 30623 ms，而 [PR #80](https://github.com/DDomelette/deepseek-harness/pull/80) 的 run 两次尝试都红在同一断言上。

轮询也无法区分写入失败用例真正关心的两种结果：文档缺失是因为检查点尚未落盘，还是因为它已经失败、永远不会落盘。这些用例改为等待日志警告，但那只证明失败被上报了，并未证明存储介质未被触碰。

## 决定

[`SessionProjectionCache.settled(id)`](../../../../packages/session/session-projection-cache/src/index.ts) 在该会话 id 已启动的每个持久检查点都已结算（无论成功或失败）后 resolve。每个 fire-and-forget 触发点——三个必写点、两个节流、以及冷读回写——在启动时接入该会话的屏障链，因此一次 await 覆盖所有在途写入，以及在调用方等待期间新启动的写入；最后启动的那个写入的屏障在结算后被丢弃。屏障建立在领域自身的持久化时刻上：`put` 在后端发布记录之后才 resolve，因此被 await 的行已经在存储介质上。

由于每个触发点包裹的都是会自行记录失败的 fail-soft 检查点，被跟踪的 promise 总是会兑现：屏障只上报完成，从不上报错误。已置脏但节流尚未触发的会话不在覆盖范围内——必写点会同步启动写入，因此没有任何套件依赖该定时器。

两个套件现在 await `settled(id)`，然后一次性读取存储文档，从而消除了本包内所有字面量死线。写入失败用例同样 await 它，并从同一个完成点同时断言警告与介质未被触碰；冷读用例也用它替换了原先临时搭的 `domain/changed` 监听器。

## 考虑过的替代方案

**把车道预算交还给 `vi.waitFor`（#73 的次选方案）。** 未作为首选修复：它能消除假红，但每个测试仍在同步一个自己无法观察的介质写入，写入失败用例也仍然无法区分“不存在”与“迟到”。这里存在真实的完成点，因此测试就用它。

**再次放宽字面量。** 5 秒 guard 此前已为这条车道放宽到 30 秒，而车道同样把 30 秒耗尽。低于车道已授予预算的死线会降低 CI 实际提供的余量。

**加重试、把套件串行化、或加 sleep。** 均不采纳：它们掩盖缺失的完成条件，而不是把它命名出来。

## 后果

session-projection-cache 的套件不再持有任何字面量 `vi.waitFor` 死线；车道给每个用例的预算成为唯一 guard，而它现在约束的是一个真实完成点，而不是轮询。`settled` 是一个服务的公开 API，而该服务的后台写入此前不可观察；`write(session)` 本就服务于测试与承载方，`settled` 服务同一批使用者。[CI 断言决定](2026-09-08-ci-readiness-and-completion.zh.md)、[CI fixture 完成与隔离](2026-09-08-ci-completion-observations.zh.md) 与 [publint 生命周期决定](2026-09-07-publint-test-subprocess-lifetime.zh.md) 在同族问题上拥有各自的结论；若某个套件观察的介质没有可 await 的完成点，它仍然需要那一类方案，而不是本方法。
