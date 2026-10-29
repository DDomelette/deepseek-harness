# Agent Note: The configured carrier cap bounds every buffered route of an activation

Status: implemented

English | [中文](2026-10-07-rpc-channel-body-cap.zh.md)

## Problem

`maxRequestBodyBytes` reached exactly one route. `apply` read it from config, asserted it against the image batch, and handed it to the bridge for the shared `/api` route; `HostConnectionService.register` — the `/api`-adjacent channel registry behind `connection.rpc.handle` — called the same bridge without it. A channel therefore buffered under the built-in 300 MiB default whatever the deployment configured, so an operator who changed the cap changed the shared route only, and the per-request resident bound the README documents did not hold for channel traffic.

## Decision

The activation resolves the cap once and gives it to the service: `HostConnectionService` takes it as a constructor field, and `register` reads it once while building the route and passes it to the bridge. Reading it at registration rather than inside the request handler keeps the limit independent of the `this` Cordis resolves per call. `ConnectionConfig.maxRequestBodyBytes` therefore bounds every buffered carrier route of that activation, and the JSDoc, the package README's carrier paragraph and its memory limitation state that.

## Alternatives considered

**Default the constructor parameter and leave the channel on the built-in cap.** Rejected: the documented per-request bound would still not describe channel traffic.

**Bound channels at the built-in default and the shared route at the configured value.** Rejected: two caps in one activation has no owner and no way for an operator to see which route answered 413.

**Expose a per-channel cap in `register`.** Rejected: the cap is a carrier property of the activation, not a per-caller choice; no current consumer needs a different one.

## Consequences

A deployment that lowers or raises `maxRequestBodyBytes` moves every buffered route with it, so a 413 on a channel and a 413 on `/api` mean the same limit. Bodies above the cap are refused before the handler runs, which the connection suite pins for both directions: a 4 KiB envelope against a 512-byte cap answers 413 with no handler call, and a small envelope on the same channel still reaches it. The backlog item this note owns is marked fixed in the [pairing backlog](../../proposed/bug-fix/2026-10-06-phone-access-and-web-surface-defect-backlog.md).
