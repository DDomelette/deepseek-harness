# Agent Note: The web surface states its own failures

Status: implemented

English | [中文](2026-10-07-web-surface-visible-failures.zh.md)

## Problem

Five defects left an operator without the fact they needed, on a surface that had it.

A `GET`/`HEAD` route could declare a request body. The bridge attached one for every method, and Fetch forbids a body on those methods, so `new Request` threw a `TypeError` before any handler ran; the two shipped `GET` routes declared the buffered mode the type required.

Escape inside the pairing panel's inline rename closed the whole dialog: the input cancelled its edit without consuming the key, and `Modal` acted on any Escape, discarding the pairing code and QR the dialog held. The repository already had the convention — lower-priority Escape owners such as the frame drawer act only on an Escape no surface closed itself with — but the modal did not follow it.

A checkout whose frontend was never built booted, printed a URL, and answered `/` with an empty 404 while the README promised a build hint.

A live patch that reloaded the Web row rebound the server without printing its URL again: the announcement was deduplicated per Context root, which survives the row's own reload.

A phone whose credential lapsed while the page was open saw nothing. The only surface rendering `connection.failure.auth` is the sidebar's connection indicator, and `SettingsRoot` suppresses it in the collapsed rail a phone always gets.

## Decision

`ConnectionRequestBodyMode` gains `'none'`, the only legal mode for a route that owns no body-carrying method; `assertFetchRoute` rejects the contradictory pairings in both directions at registration, and the two `GET` routes declare `'none'`. The bridge refuses a client-framed body on such a route with a 400 and closes the connection, instead of letting Fetch throw a `TypeError` no handler can see.

`Modal` ignores an Escape that was already handled (`defaultPrevented`), and the pairing panel's rename input consumes the Escape it cancels with. Cancelling an inline edit therefore leaves the dialog, the code, and the QR in place.

A missing dist index answers the shell request with a 404 whose body names the build command; asset and route misses keep their empty 404.

The readiness line is announced once per activation rather than once per Context root, so a Connection reload inside one activation stays quiet while a live patch reload prints the URL of the server the new activation bound.

The session-required screen is registered on every page and states a lapsed credential from either source: the `__DSH_AUTH_REQUIRED__` boot fact of a document the Host refused, or the connection's own `failure` source once it reports `auth`. It renders null while the session works.

## Alternatives considered

**Let a `GET` route keep a body mode and strip the body in the bridge.** Rejected: the mode would then describe nothing, and the contradictory declaration would stay legal at the one place it can still be caught.

**Drain a body framed on a bodyless method.** Rejected: the frame is a protocol violation, and answering 400 keeps the failure visible instead of silently discarding bytes.

**Stop the boot when the dist is missing.** Rejected: a composition whose page never reaches the static fallback carries no dist by design, so the missing index is a request-time fact; the hint belongs on the response and the README now says so.

**Deduplicate the announcement per process.** Rejected: a live patch can rebind to a different port, and a URL line for a server that no longer serves the GUI is worse than a repeated line.

**Show the failure in the collapsed rail.** Rejected: the rail is a narrow strip on a handset, and the mob bundle already owns a full-surface screen with the copy that names the computer setting which creates a new pairing code.

## Consequences

The Fetch-route contract states which methods can carry a body, and a mis-declared route fails at registration rather than at its first request. An Escape cancels one surface at a time, innermost first. An unbuilt checkout tells the operator what to run. A live-patched Web row announces the server it bound. A phone whose credential lapses reads the reason and the remedy on the page it is looking at, without the sidebar it never sees. The five backlog items this note owns are marked fixed in the [pairing backlog](../../proposed/bug-fix/2026-10-06-phone-access-and-web-surface-defect-backlog.md).
