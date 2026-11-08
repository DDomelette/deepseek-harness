# Agent Note: Remote administration stays with the operator

Status: implemented

English | [中文](2026-11-09-operator-only-remote-administration.zh.md)

## Problem

A paired device is an admitted Remote caller: `admit()` returns that device's Peer for its cookie, the `/api` route checks only the Host/Origin fence and browser authentication, and the settings controller's `@Remote` methods carried no authority class. A phone paired to *use* the agent could therefore invoke `settings/mutate` and rewrite every volatile configuration field — the model provider's `baseURL`, the MCP server roster (whose `command`/`args` the Host spawns), the bind policy, tool timeouts — even though the GUI keeps settings read-only for non-loopback pages. Pairing is consent to use the agent; it was never consent to administer the Host. The client-side persistence rule was the only thing that refused, and a hand-written RPC call bypasses it.

## Decision

`connection.reserveOperatorOnly(endpoint)` reserves one shared-channel RPC endpoint for the operator's Peer. The shared Fetch handler answers 403 to every other admitted Peer before dispatch; the reservation is an effect, so disposal restores access. The Remote assembly reserves the settings write endpoints — `settings/update`, `settings/replace`, `settings/mutate`, `settings/openSettingsDocument` — because the assembly publishes that surface and the controller cannot see its caller.

Reads stay admitted: a redacted namespace description is not administration, and the phone shell may still describe namespaces. Enforcement lives in the transport because the transport is the only layer that knows which credential admitted the request; the Peer deliberately records no authority of its own.

## Alternatives considered

- **Keep the client-side rule only.** Rejected: `ui-settings` keeps non-loopback forms process-local, but that is UI policy — a device can call the endpoint directly, and nothing on the Host would refuse it.
- **Check inside `SettingsController`.** Impossible as the code stands: a Remote method receives no request, so it cannot tell the operator's cookie from a device's.
- **Allowlist the namespaces a device may call.** Rejected for now: every namespace would need a product decision, and an incomplete allowlist breaks the phone's own shell. Reserving the administration verbs keeps the change bounded.
- **Declare an authority class in Typert Remote.** The right long-term home, but a protocol-level change; the reservation expresses the same rule today with the credentials the transport already holds.

## Consequences

- A paired device keeps the agent, session, workspace, upload, and stream surface; every reserved configuration write answers 403 instead of silently succeeding.
- The operator keeps the reserved endpoints on every authority it declared, the bound LAN address included — the same credential rule `/pair/*` already applied to device management.
- The settings page's non-loopback behaviour is unchanged; that UI policy now matches what the transport enforces.
- Other administration surfaces — credential writes, plugin installation, account linking — are not reserved yet and need the same audit before the line is drawn.

## Testing

- `packages/client/connection/tests/operator-only-rpc.host.spec.ts` — the operator Peer passes, a device Peer gets 403, unreserved endpoints stay open, releasing a reservation restores access, and malformed endpoint names are refused.
- `packages/api/remotes/tests/operator-only.host.spec.ts` — the assembly reserves the four settings write endpoints and releases them on disposal.
- `apps/web/tests/phone-pairing.e2e.ts` — a paired phone cannot manage pairing and sees no policy controls on the Connect-phone page, while the operator's LAN page stays editable.

## Related

- [Connect phone page and the saved bind policy](../feature/2026-11-08-connect-phone-page-and-bind-policy.md) — the page whose policy write motivated the reservation.
- [Browser token authentication](../architecture/2026-08-24-browser-token-authentication.md) — the operator and device credential classes this rule separates.
- [LAN Web serving](../architecture/2026-09-11-lan-web-serving.md) — the fence and pairing model the device credential comes from.
