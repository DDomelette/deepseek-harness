# Agent Note: Projection-cache checkpoints report write completion

Status: implemented

English | [中文](2026-10-07-projection-cache-write-completion.zh.md)

## Problem

Both session-projection-cache suites observed durability by polling the stored JSON document with literal `vi.waitFor` deadlines: `5_000` in [`cache.spec.ts`](../../../../packages/session/session-projection-cache/tests/cache.spec.ts) and `REWRITE_GUARD_MS = 30_000` in [`fixtures.spec.ts`](../../../../packages/session/session-projection-cache/tests/fixtures.spec.ts). The Windows coverage lane grants each case 90 seconds, but `vi.waitFor` accepts only the literal at the call site, so those deadlines sat far below the lane's budget. Under the fork lane's oversubscription — 4 vCPU, two instrumented partitions, a second gate — the write-through tail latency crossed them: [issue #73](https://github.com/DDomelette/deepseek-harness/issues/73) records the 30-second guard consumed at 30623 ms, and the run for [PR #80](https://github.com/DDomelette/deepseek-harness/pull/80) failed the same assertion in both attempts.

Polling also cannot separate the two outcomes the failed-write cases care about: a document still missing because the checkpoint has not landed, and one that will never land because the checkpoint failed. Those cases waited for the logged warning instead, which proves the failure was reported but not that the medium was left untouched.

## Decision

[`SessionProjectionCache.settled(id)`](../../../../packages/session/session-projection-cache/src/index.ts) resolves once every durable checkpoint the cache has already started for that session id has settled, successful or failed. Every fire-and-forget trigger — the three mandatory points, both throttles, and the cold-read write-back — joins its session's barrier chain when it starts, so one await covers the writes in flight and any write started while the caller waits; the barrier of the last started write is dropped once it settles. The barrier rests on the domain's own durability moment: `put` resolves after the backend published the record, so an awaited row is on the medium.

Because each trigger wraps a fail-soft checkpoint that logs its own failure, tracked promises are total: a barrier reports completion, never an error. A dirty session whose throttle has not fired is not covered — mandatory points start their write synchronously, so no suite depends on the timer.

The suites await `settled(id)` and then read the stored document once, which removes every literal deadline from this package. The failed-write cases await it as well and assert both the warning and the untouched medium from that single completion point, and the cold-read cases replaced their ad-hoc `domain/changed` listener with the same call.

## Alternatives considered

**Give `vi.waitFor` the lane budget (the fallback in #73).** Rejected as the primary fix: it removes the false red but keeps each test synchronizing on a medium write it cannot observe, and leaves the failed-write cases unable to distinguish absence from lateness. A completion point exists here, so the tests use it.

**Raise the literals again.** The 5-second guard had already been raised to 30 seconds for this lane, which consumed that too. A deadline below the budget the lane already grants lowers the margin CI actually provides.

**Retry the assertion, serialize the suite, or add a sleep.** Rejected: each masks a missing completion condition instead of naming it.

## Consequences

The session-projection-cache suites hold no literal `vi.waitFor` deadline; the lane's per-case budget is the only guard left, and it now bounds a real completion point rather than a poll. `settled` is public API on a service whose background writes were previously unobservable; `write(session)` already served tests and carriers, and `settled` serves the same audience. The [CI assertions decision](2026-09-08-ci-readiness-and-completion.md), [CI fixture completion and isolation](2026-09-08-ci-completion-observations.md), and the [publint lifetime decision](2026-09-07-publint-test-subprocess-lifetime.md) own the same class elsewhere; a suite that observes a medium with no completion point to await still needs that class's remedy rather than this method.
