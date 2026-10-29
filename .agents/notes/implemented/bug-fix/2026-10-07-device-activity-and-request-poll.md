# Agent Note: A phone's use is recorded by its requests, and the panel reads the waiting list one at a time

Status: implemented

English | [中文](2026-10-07-device-activity-and-request-poll.zh.md)

## Problem

A device's `lastSeenAt` only ever moved inside the pairing handshake: `registerDevice` wrote it once and nothing else wrote it, so the Connect-phone panel's *last used* column kept showing the approval time of a phone that had been using the application for days. The authenticated-request path had the device in hand already — it resolves the presented cookie's `deviceId` to decide whether to stage an aligned replacement — but recorded nothing about the request itself.

The panel read the waiting requests from a two-second interval with no in-flight guard. Every tick started its own `/pair/state` request, so a Host slower than the interval accumulated overlapping reads and the answer that started first could land last, putting an older waiting list back on screen. A decision raced the same way from the other side: the refresh it issued had no ordering against a poll already on the wire, so a decided request could reappear in the list — clickable again, and refused by the Host — until the next tick replaced it.

## Decision

The authenticated-request path records the device as well as the credential: `noteDeviceRequest` stages the aligned cookie when the credential lags the registry window and then advances that device's stored last use. The registry's existing one-hour throttle keeps a phone that is in use at one credential write an hour, and a failed write is reported as a warning instead of thrown, so it cannot fail a request the Host has already authorized.

The panel reads the waiting list through one shared read that holds at most one request in flight — a tick that lands during a read is dropped rather than started. A decision marks any answer already on the wire as overtaken, discards it whole because it describes the list from before the decision, waits for it to settle, and only then reads again, so the refresh always starts after the decision it reports. The answered request leaves the list immediately, which removes the window in which a decided row could be clicked a second time.

## Alternatives considered

**Advance the last-seen time on every request without the throttle.** Rejected: the credential file is the durable store, and a phone using the application would rewrite it on every call.

**Record device activity in the pairing routes only.** Rejected: those routes are the computer's own surface, and a phone that is in use never calls them.

**Let polls overlap and discard answers out of order.** Rejected: discarding needs an ordering token on every read, while holding one read in flight makes the overlap impossible in the first place.

**Add a sequence number to the `/pair*` answers.** Rejected: it changes a wire contract to fix client-side ordering, and the client can order its own reads.

## Consequences

The panel's last-used column follows real use, at the cost of at most one registry write an hour per device. A slow Host costs one in-flight read instead of one per tick, the list on screen is the newest answer the panel asked for, and an answered request cannot be clicked again. The connection README's claim that `dsh web --host 0.0.0.0` is unsupported is replaced with the current default bind and the LAN addresses it trusts. The backlog items this note owns are marked fixed in the [pairing backlog](../../proposed/bug-fix/2026-10-06-phone-access-and-web-surface-defect-backlog.md).
