# Agent Note: Standard hosted runners for fork CI

Status: implemented

English | [中文](2026-09-19-fork-ci-hosted-runners.zh.md)

## Problem

A fork inherits workflow files without inheriting access to the upstream enterprise runner pools. Pull requests inside that fork can leave the static, coverage, artifact, and Windows jobs queued indefinitely, so the aggregate verdict cannot finish.

## Decision

The [pull-request workflow](../../../../.github/workflows/ci.yml) selects standard GitHub-hosted Linux and Windows runners when the repository receiving the event is a fork. The base repository's fork flag owns this choice; a contribution from a fork to the upstream repository retains upstream routing. The explicit repository-controlled [failover switches](2026-07-26-ci-failover-runbook.md) retain precedence and their Dependabot exclusion.

Fork jobs use smaller gate, coverage, browser, and snapshot concurrency budgets. They execute the same commands, test inventory, coverage thresholds, and aggregate dependencies as upstream jobs. Fork Linux coverage uses the same 90-second test and cleanup budget as Windows coverage: cold TypeScript generation and native process-range teardown share the smaller runner. Product deadlines and assertions remain unchanged. The existing non-blocking Windows lanes retain their status.

## Alternatives considered

**Require every fork to provision enterprise runners.** Repository copies do not carry access to those pools; standard hosted runners allow contributors to execute the checks without that infrastructure.

**Skip unavailable jobs or remove them from the verdict.** That would make a successful aggregate omit required evidence. Adjusting routing and worker budgets preserves the checks.

## Consequences

Fork CI can execute the complete pull-request workflow with standard hosted capacity, at the cost of longer runs. Real-provider tests, preview deployment credentials, and review approval remain separately configured concerns. Routing regressions cover fork and upstream repositories, explicit failover, and Dependabot; the actual hosted run owns the full execution evidence.
