# Agent Note: Readiness follows committed startup

Status: implemented

English | [中文](2026-10-06-readiness-follows-committed-startup.zh.md)

## Problem

`web-app` announced the URL line and opened the default browser when the Loader settled. The Loader settle reports rejected rows: a row that can never activate — a patch layer inserting a row whose injected service nothing provides, or one whose dependency another row's disable removed — stays pending, settles the tree without failing it, and is rejected only by the boot's own `assertEntriesActivated` afterwards. `dsh web` therefore printed `dsh web: http://…` and opened a GUI for a tree that aborted in the next microtask, while the module's own contract and the README both call that line the signal supervisors act on.

## Decision

When the launcher provides `appReady` — an `onReady` that fires only after boot and host setup commit — the announcement registers there and never waits on the Loader, and the registration is an effect so a tree disposed before the commit drops it. A composition without that signal keeps the Loader path, and a hand-built tree without a Loader still announces at once.

## Alternatives considered

- **Keep the Loader path and document the gap.** Rejected: the line's whole purpose is to mark the boundary where the deployment is live.
- **Wait for the Loader and then a fixed delay.** Rejected: a delay is not a signal, so it either hides real readiness or still prints for a tree that fails later.
- **Let the boot print the line itself.** Rejected: it would move the launch token, the LAN snapshot, and the browser handoff into app boot, which owns none of them, and every other host (the worker preview, the desktop host) would inherit a line it must not print.

## Consequences

- `dsh web` prints the line exactly when the composition is live; a tree that fails its activation audit prints nothing and exits with the boot's own diagnostic.
- The readiness contract has one owner, the launcher's startup signal, and listeners a tree registers there are removed with that tree.
- A composition that provides no startup signal keeps the previous timing, and the README records that fallback.

## Testing

`packages/bundle/web-app/tests/web-app.spec.ts` provides a launcher double whose `commit()` the test controls: after the Loader settles nothing is printed and no browser opens, and after the commit both happen. With the gate removed the spec failed as `expected "log" to not be called at all, but actually been called 2 times`.
