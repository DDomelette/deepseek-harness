# Agent Note: Cookies repeat and mapped loopback is loopback

Status: implemented

English | [中文](2026-10-07-wire-cookie-and-loopback-forms.zh.md)

## Problem

Two Tier 3 defects lived on the wire between a browser and the Host.

The bridge built its response headers with `Object.fromEntries(response.headers.entries())`. `set-cookie` is the one response header that may repeat — a route that sets two cookies produced two header entries, and the object kept only the last — and `writeHead(status, headers)` then replaced whatever the request path had staged with `setHeader`, which is exactly how a device-cookie renewal is staged before the route runs. A renewal could therefore be dropped by the same response that triggered it, and a route's own cookies could lose all but one value.

Loopback classification knew fewer forms than the platforms report. `isLoopbackHostname` accepted `localhost` and `[::1]` only, so `localhost.` — the absolute form of the same name, which a browser may send — and an IPv4-mapped literal such as `[::ffff:7f00:1]` were treated as remote authorities; `isLoopbackPeer` accepted `::1` only, so a dual-stack listener reporting a v4 loopback peer as `::ffff:127.0.0.1` failed the loopback check that guards pairing decisions.

## Decision

The bridge collects response headers itself: every `set-cookie` value is kept in order, a value staged before dispatch is prepended, and the result is written as a list. A single cookie is a one-element list to node:http, which emits one header either way.

`isLoopbackHostname` strips one trailing dot and unwraps an IPv4-mapped IPv6 literal into the IPv4 address it carries (both the dotted and the two-hex-group forms), then applies the existing 127/8 test; the peer block list gains `::ffff:127.0.0.0/104`, the mapped form of 127/8.

## Alternatives considered

**Forward only the last cookie.** Rejected: silently dropping a cookie is a session defect, and the header is defined to repeat.

**Have the renewal path set its cookie after the route answers.** Rejected: the route's response is produced by shared code that already writes its own headers; merging at the bridge is the single place that sees both.

**Treat every `::ffff:` literal as loopback.** Rejected: the mapped form carries an arbitrary IPv4 address, and `::ffff:192.168.1.6` must stay remote. Only the mapped 127/8 range qualifies.

**Normalize hostnames with `new URL()` before classifying.** Rejected: the predicate runs on hostnames a URL parser already produced, and a second parse would reject the bracket forms it must classify.

## Consequences

A response that both renews a device cookie and sets its own reaches the client with every cookie, in a defined order. A browser that addressed the GUI as `localhost.` or through a mapped literal is recognized as local, so its pairing decisions pass the same fence a plain `127.0.0.1` does, while a mapped LAN address stays remote. Both backlog items this note owns are marked fixed in the [pairing backlog](../../proposed/bug-fix/2026-10-06-phone-access-and-web-surface-defect-backlog.md).
