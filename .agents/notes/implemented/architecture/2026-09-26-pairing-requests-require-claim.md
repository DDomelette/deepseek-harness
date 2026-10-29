# Agent Note: Pairing requests require a claiming phone

Status: implemented

English | [中文](2026-09-26-pairing-requests-require-claim.zh.md)

## Problem

`PairingSessions.pending()` listed every undecided session, including the one the computer itself had just minted. The moment the operator clicked *Create pairing code*, the panel's "waiting for a decision" section showed a request card for that fresh code — with the fallback device label — although no phone had scanned anything, and clicking *Allow* registered a device no phone held.

## Decision

A session becomes a request only when a phone claims its code: `pending()` filters to sessions whose `userAgent` `recordAgent` recorded, which happens exactly on the phone's `GET /pair?c=<code>`. `PendingPairing.userAgent` tightens from `string | undefined` to `string` to match. The claim signal was chosen over `stateOf` polling because the screen route is the handshake's mandatory first step and the only point that sees the phone's `User-Agent`.

`approve` is deliberately not gated on the claim: the panel can no longer reach an unclaimed code, and the loopback-only route is the operator's own surface, so the extra refusal would guard against a caller that is already trusted.

## Alternatives considered

- **Gating `approve` on a recorded agent.** Rejected above: it churns the decision union and the route tests to stop a call only the local operator can make, while the phantom-registration path is already closed by the claimed-only list.
- **Treating a `/pair/state` poll as the claim.** Rejected: a poll carries no `User-Agent` worth prefilling a label from, and a phone that somehow polls without loading the screen still learns nothing it can act on.

## Consequences

- `GET /pair/requests` answers an empty list between code creation and the phone's first screen load; the panel's waiting section shows its empty state until a real device appears.
- The phantom-device path is closed at the product level: *Allow* always names a phone that claimed the code, so every registered device row has a holder.
- [Phone access in the web profile](2026-09-12-phone-access-in-the-web-profile.md) remains the authority for the handshake; this note owns only what counts as a request.
