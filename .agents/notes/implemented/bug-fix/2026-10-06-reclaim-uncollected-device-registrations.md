# Agent Note: Approval rows whose phones never collected a cookie are reclaimed

Status: implemented

English | [中文](2026-10-06-reclaim-uncollected-device-registrations.zh.md)

## Problem

An approval registers the device row and binds the code to it; the phone then collects its cookie by reading that code. When the phone never reads it — a backgrounded tab whose timers are frozen is the ordinary case, and a code that expires while the approval is still in flight is another — the session expired with the registration still attached and nothing reclaimed it. The row stayed active, with its delivery window, in the panel's paired list and in the recycle bin's reach, so the operator saw a device the host believed was paired while the phone showed the code-expired copy. The repository already states the invariant this breaks: `packages/bundle/mob/tests/routes.host.spec.ts` records "the operator's device list keeps no row no phone holds" for the binding race, and only that race had a rollback.

## Decision

A code that expires while still holding a device id is the signal that its phone never collected the cookie. `PairingSessions.sweepExpired()` drops exactly those sessions and returns their device ids, and the two routes that mean "pairing is in use" — `POST /pair/session` and `GET /pair/devices` — reclaim each id through the same revoke-then-purge rollback the binding race already used, awaited so the device list in that same response is accurate. The store's own sweeps leave a bound session alone: deleting it there would lose the id, and an expired session without a registration keeps its previous lifecycle so a late read still answers `expired`.

## Alternatives considered

- **Reclaim from the store through an injected hook.** Rejected: the hook fires while the list is being built, so the response that triggered it still shows the row, and it makes reclamation asynchronous exactly where the operator is looking. The route awaits the reclamation instead.
- **Reclaim during every sweep.** Rejected: the internal sweeps run on unrelated routes with no response to correct, and a failed reclamation there would be invisible.
- **Keep the row and mark it in the panel.** Rejected: a registration no phone holds has no use — the phone that lost the cookie must pair again anyway, and the row only invites the operator to extend or trust a credential that was never delivered.
- **Expire the row instead of deleting it.** Rejected: the window the operator set is not the reason it is dead, so an expired-but-present row would be indistinguishable from a device whose credential lapsed.

## Consequences

- The panel's paired list and the registry agree with reality: an approval nothing claimed leaves no row, and the code that carried it is gone with it.
- A phone still polling a reclaimed code now reads `unknown` instead of `expired`; both render the same "create a new code" copy, and `unknown` counts toward the per-source failure budget exactly as it does for any other code the host does not hold.
- Reclamation runs when the operator opens a code or reads the device list, so a row lingers until the panel is next used; nothing else can observe it.
- A reclamation that fails is logged and leaves the row for the operator to revoke, which the panel already offers.

## Testing

- `packages/bundle/mob/tests/routes.host.spec.ts` drives the real routes: claim, approve, read the list (the row is there), advance past the code's expiry, read again and observe the row revoked and purged and absent from that same response, then observe the code answering `unknown`. Without the change it failed as `expected { devices: [ { …(4) } ] } to deeply equal { devices: [] }` with `"id": "device-1"` still listed.
- `packages/bundle/mob/tests/pairing.spec.ts` keeps pinning the store's own lifecycle: a consumed code is gone, an expired code without a registration still answers `expired`, and an expired bound code survives until `sweepExpired()` reaps it.
- `apps/cli/tests/pairing.e2e.ts` asserts the recycle-bin row after revocation through the real CLI, which is what its earlier `devices: []` expectation predated.
