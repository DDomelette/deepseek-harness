# Agent Note: A registration is released by identity, and an unbuilt dist is a miss every index surface answers

Status: implemented

English | [中文](2026-10-07-webserver-registration-identity-and-index-miss.zh.md)

## Problem

Each of the webserver's three registries released its entry by key: `register` and `registerUpgrade` deleted by path, and `registerFallback` cleared the seat unconditionally. A disposer that ran after its owner had already been replaced therefore removed whatever held the path — or the seat — at that moment, which is a live route disappearing under a running server.

The fallback seat exposed a second problem while fixing the first. A Cordis service method runs with a `this` the framework resolves through the calling Context, so reading `this.fallback` inside a disposer runs against a Context that has already been disposed by the time the disposer is called; the comparison then reads `undefined` and the seat is never released. The registration-time write, by contrast, reaches the service instance, so the stale seat stayed claimed and a later owner could not register.

The fallback's 405 named no methods, leaving a client to guess which request would work. The MIME table omitted `.woff2`, `.woff`, `.ttf`, and `.png` — the icon fonts and images the shipped dist actually contains — so browsers received them as `application/octet-stream`.

`FrontendService.renderIndex()` rejected when the dist had no `index.html`. The fallback seat caught that and answered the actionable 404 naming `pnpm run build`, but the pairing screen (`/pair`) awaits the same method: its rejection escaped the route handler into the webserver's last-resort guard, which answers 400 — a phone scanning a code against an unbuilt checkout read "bad request" instead of "this Host serves no application shell".

## Decision

Every registration releases itself only while it is still the registered value: the route tables compare the stored route against the one the disposer was created for, and the fallback seat holds its handler in a one-key holder object that the registration captures. The holder is what makes the comparison independent of `this`, because the closure keeps the object rather than reading a field through a Context that may be gone.

The fallback answers `405` with `Allow: GET, HEAD`, the methods that seat serves.

The MIME table gains the four extensions the shipped dist carries, with the font types served as `font/woff2`, `font/woff`, and `font/ttf` and images as `image/png`.

`FrontendService.renderIndex()` returns `undefined` when the dist has no readable `index.html` and still throws every other read failure. The fallback seat answers that `undefined` with the same 404 and build hint it already produced, and the pairing screen answers it with the existing 503, so both index surfaces report the same cause in their own response.

## Alternatives considered

**Delete by key and accept the replacement race.** Rejected: a late disposer silently withdrawing a live route is a request-serving failure with no visible cause, and the identity comparison costs one read.

**Keep `this.fallback` and guard with the raw service instance.** Rejected: reaching the instance means depending on Cordis traceable-proxy internals; a holder captured at registration uses only the published behavior.

**Answer a missing dist index with an empty 404 like any other miss.** Rejected: the readiness line has already printed a URL, so the operator needs the step that produces the shell; the pairing route keeps its own 503 for the same absence.

**Have `renderIndex()` answer the response.** Rejected: the pairing route injects its boot fact into the returned bytes, so the method returns the shell rather than owning a response.

**Cover the dist index read failure with an unreadable file.** Rejected: no portable fixture produces a permission failure on Windows and Linux alike; the spec reaches that arm through a configured path Node refuses to read instead.

## Consequences

A registration outlives any disposer that is not its own, including a second call to a disposer that already ran. A seat that is released stays released, so a replacement owner can claim it. Clients that probe the shell learn which methods the seat answers. Fonts and images reach browsers typed instead of as opaque downloads. A checkout whose dist is unbuilt reports the build step on `/` and "no application shell" on the pairing screen, and a genuine index read failure still fails loudly. The backlog items this note owns are marked fixed in the [pairing backlog](../../proposed/bug-fix/2026-10-06-phone-access-and-web-surface-defect-backlog.md).
