# Agent Note: Connection failures name their cause

Status: implemented

English | [中文](2026-09-12-connection-failure-surfacing.zh.md)

## Problem

Every connection problem looked identical in the Web GUI: the sidebar pill kept saying "reconnecting" while the application showed no data. A browser session that had expired, a Host that had stopped, a rejected authority, and a client-side exception raised exactly the same text, so the operator could neither act nor report what happened. Diagnosing the 2026-09-12 phone outage on a LAN deployment required a temporary instrumented server and a request log, because the client discarded the reason before any surface could show it.

## Decision

The connection loop reports the failure of any generation that never became ready, and the connection service publishes it as `connection.failure`: `{ reason, detail }`, where `detail` is the carrier's message verbatim and `reason` is one of `auth`, `forbidden`, `timeout`, `unreachable`, or `internal`.

Classification happens where the evidence exists:

- `auth` (401) and `forbidden` (403) come from the last refused unary call. A browser reports a rejected WebSocket upgrade as an opaque connection error, so the unary status is the only HTTP evidence available; a successful unary call clears the record, which keeps a stale refusal from labelling a later, unrelated outage.
- `internal` covers a thrown `TypeError`, `ReferenceError`, or `SyntaxError`: a client-side fault rather than a carrier condition, which is exactly the class of failure that broke phones running engines below the shell's browser floor.
- `timeout` is the readiness deadline; everything else is `unreachable`.

Failures clear when a generation connects. Intentional aborts (manual reconnect, the browser going offline) and a stopped loop report nothing, because they are not carrier failures.

The settings shell renders the reason through the existing `ConnectionIndicator`: a localized reason line (owned by the `settings` dictionary) plus the verbatim detail, which stays untranslated because it is diagnostic data.

## Alternatives considered

- **Probe an endpoint on failure to read the HTTP status.** Rejected: the unary calls the application already makes carry the same status, and a probe would add a request per retry against a Host that may be down for reasons unrelated to authentication.
- **Publish the raw `Error` object to the UI.** Rejected: the classification is the actionable part, and a raw error would force every surface to re-derive it, including the locale mapping.
- **Show the failure only in a log or console.** Rejected: the phone has no reachable console, which is the deployment this work exists for.
- **Keep the transport-neutral "reconnecting" text.** Rejected: it cannot distinguish causes a user can fix (sign in again, rejoin the right network) from ones they cannot.

## Consequences

- An outage now names its cause in the sidebar pill, and the raw detail stays available through the indicator's `title` and visible text.
- `auth` labelling depends on a refused unary call having happened since the last successful one; an outage that never issues a unary call classifies as `unreachable` with the carrier detail, which still distinguishes it from a client-side fault.
- The reason vocabulary is closed. A new category (for example a proxy that interrupts streams) needs a member here plus its localized line in the `settings` dictionary.
- `ConnectionSinks.onFailure` is the only new contract on the loop; the controller's retry, backoff, and state semantics are unchanged.
