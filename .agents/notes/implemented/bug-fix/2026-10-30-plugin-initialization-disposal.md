# Agent Note: Own plugin resources before asynchronous initialization

Status: implemented

English | [中文](2026-10-30-plugin-initialization-disposal.zh.md)

## Problem

Plugin disposal can begin while a cursor or storage domain is loading. Registering cleanup after that await throws `INACTIVE_EFFECT` on a disposed fiber, leaving newly created intervals running or a domain name reserved. Re-enabling Notes or Session Pins then fails with `already-open` while the storage facility remains mounted.

## Decision

The usage exporter, Notes domain owner, and Session Pins register asynchronous Cordis effects before starting initialization. These effects retain cleanup responsibility until setup and disposal settle, following the [runtime ownership rules](../architecture/2026-07-12-agent-scope-runtime-design.md). Storage acquisition returns its close disposer through the existing effect, including when the owner was disposed while the open was pending. The domain facility retains its caller-owned handle policy.

The exporter checks its fiber after loading the cursor and starts no timers or requests if that fiber is disposed. Its effect stops both timers before joining batch and heartbeat work. Session Pins publishes its global and flag provider only while its fiber remains mounted, and clears readiness when closing the domain.

## Alternatives considered

**Catch inactive-effect errors after acquiring resources.** Catching the error does not give those resources an owner or close the domain. Ownership must precede the await.

**Tie every domain to the storage facility's fiber.** The facility outlives individual consumers, so unloading one consumer would retain its reservation and prevent reloading. The consumer owns the returned handle and its cleanup.

**Add a separate cancellation controller for each initializer.** Cordis already joins pending effect setup and disposal. A second controller adds state without another operation or settlement point to own.

## Consequences

Unloading waits for initialization to settle; it does not cancel a storage backend's open. Late handles close before disposal resolves, and the consumer can reload without restarting storage. Tests hold initialization behind explicit barriers, dispose the consumer, then release setup and verify domain reopening, flag removal, and absence of post-disposal exporter requests. Normal reloads exercise the same owners.
