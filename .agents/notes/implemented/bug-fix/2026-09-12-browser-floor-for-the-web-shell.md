# Agent Note: Browser floor for the Web shell

Status: implemented

English | [中文](2026-09-12-browser-floor-for-the-web-shell.zh.md)

## Problem

`dsh mob` serves the Web shell over plain HTTP to whichever engine an operator's phone already has, and phone WebViews rarely receive an update. Several shipped client bundles call standard APIs newer than those engines: `AbortSignal.any` (Chrome 116, Safari 17.4) in the API gateway's generation path and in the workspace and deliverables UI, `Promise.withResolvers` (Chrome 119, Safari 17.4) in the approval, user-question, workspace-files, and dynamic-runner bundles, and the ES2025 `Iterator` global (Chrome 117, Safari 18.4) that pdfjs-dist references at import time.

On a Chrome 114 Android browser the failure is silent and total: the mux WebSocket completes its upgrade and then dies within a second, because the gateway's stream read throws `TypeError: AbortSignal.any is not a function`. The client retries with backoff forever, so the shell renders while sessions, workspaces, and messages never arrive. Authentication, cookie binding, the Host fence, and the LAN path are unaffected — every `/api` response in the captured trace was 200.

## Decision

`packages/client/web/src/compat.ts` owns the browser floor, and `AppWebEntry.run()` installs it as its first step, before the boot imports a bundle: `AbortSignal.any` (fusing sources with the first aborting reason, and releasing source listeners once the fused signal aborts), the `Iterator` carrier described in [Iterator global shim for pdfjs-dist on pre-ES2025 browsers](2026-09-11-iterator-global-shim.md), and `Promise.withResolvers`. Each definition is skipped when the engine already provides the API.

Two scripts run before the shell and therefore build their own primitives instead of calling the floor: the host's injected boot-readiness tail (`packages/host/webserver/src/injections.ts`) and the worker-preview bootstrap (`packages/experimental/webworker-runtime/src/client/index.ts`) construct their deferred with `new Promise`.

## Alternatives considered

- **Rewrite each call site to avoid the API.** Rejected: `AbortSignal.any` is the correct way to fuse signals, so hand-rolling it per call site trades a 30-line floor for edits in five packages, and it leaves third-party browser code carried by the bundles (pdfjs-dist, React, and the other bundle inputs) uncovered.
- **Ship a polyfill library (core-js).** Rejected for the same reason as the Iterator shim: the whole library would be paid for by every browser to cover three APIs.
- **Declare a minimum browser version.** Rejected: the deployment target is a phone the operator already owns, and the failure mode offers no actionable signal — the shell looks alive while no data arrives.

## Consequences

- Engines older than the newest API in the floor boot a working application; current engines skip every definition, so the floor costs nothing there.
- The floor covers exactly the three APIs the shipped bundles call today. A bundle that reaches for another API of this class (`Object.groupBy`, `Array.fromAsync`, `Set.prototype.union`, …) needs its own definition here, and nothing detects that omission automatically.
- `Iterator` coverage remains `join`-style prototype writes; iterator helpers called as methods (`Iterator.from`) still need a real polyfill.
- `apps/web/tests/legacy-engine.e2e.ts` deletes the APIs in the browser, boots the built application, and asserts the mux streams frames, so a floor that stops covering a bundle fails the suite instead of a phone.
