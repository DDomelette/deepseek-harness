# Agent Note: Device credentials are recorded and renewed on any authenticated request

Status: implemented

English | [中文](2026-10-06-device-credential-truth-and-renewal.zh.md)

## Problem

An operator paired a phone while `deviceLifetimeDays` was 1 — the shipped default — and set that device's window to 90 days in the Connect-phone panel 98 seconds later. The panel reported `90 days (87 days left)` from the registry, and the phone showed the session-required screen. The device cookie carries the expiry it was minted with, and an extension reached a phone only through a document load ([per-device device lifetime](../feature/2026-09-13-device-lifetime-authority.md)), so that phone held a one-day credential against a ninety-day window: it lapsed at its mint-time expiry, every later request — index included — was refused before the renewal ran, and no stored field could tell the panel what the phone actually held. The operator's next move, extending the window again, cannot reach a phone whose browser has already dropped the cookie.

## Decision

Two facts change: the registry records the credential a phone holds, and any authenticated request may renew it.

**The registry records the credential.** `BrowserAuth` reports every device cookie it mints to `recordCredentialExpiry`, which writes that payload expiry onto the device's entry as `credentialExpiresAt` — at the pairing handshake and on every renewal. `restoreDevice` carries the field through a bin-and-restore cycle like the window fields. The Connect-phone panel reads it: `90 days (87 days left)` while the credential matches the window, `90 days (2 days left on the phone)` while the phone still holds a shorter credential that its next request replaces, and `Credential expired — pair again` once the credential that phone holds has passed, whatever the window still says. The phone's own session-required screen names an expired or revoked credential instead of claiming the device is not paired.

**Any authenticated request may renew it.** `BrowserAuth.renewedDeviceCookie(request)` answers the aligned `Set-Cookie` for a request whose accepted device cookie lags its registry window, and the index route, the `/api` prefix route, and every RPC channel route stage it on their response. A phone holding the application open therefore picks an extension up on its next call instead of its next document load. The registry stays the authority in both directions: a shortened window stages nothing and refuses the device on the next request, and a credential whose payload already lapsed is refused before the renewal runs, so nothing here revives one — that phone pairs again.

## Alternatives considered

- **Make the registry the only lifetime authority.** Drop the payload-expiry test for device cookies and mint them with a long `Max-Age`, so an extension and a shortening both apply with no renewal at all. Rejected: the browser still drops a cookie at its own `Max-Age`, so the change fixes credentials minted after it and does nothing for the already-lapsed phone; and it gives up the property that a device credential dies on its own, leaving a stolen cookie alive for as long as the registry keeps the device.
- **Have the phone reload its document when it learns its credential is stale.** Rejected: it needs a new Host-to-Client signal, client behavior, and copy to settle a fact one response header can carry, and it cannot help the phone whose cookie lapsed while the application was closed.
- **Keep the index-only renewal and only fix the panel's wording.** Rejected: the reported case would then remain a one-way door — the operator extends a window, the panel warns that the phone must load the page in time, and a phone that missed that window still needs a full re-pairing with no way to avoid it.
- **Refresh the cookie on the `/api` carrier specifically, leaving channel routes alone.** Rejected as asymmetry without a reason: the renewal is one method on `BrowserAuth`, and every authenticated route that owns a response stages the same header from it.

## Consequences

- A newly paired phone's `credentialExpiresAt` equals its window end, so a phone that never returns is reported as lapsed the moment its one-day default passes, instead of reading as a live credential for the rest of the window.
- An extension applies to an active phone within one request. The renewal writes the credential record once per extension, because an aligned credential stages nothing.
- The renewal adds no work to the ordinary request path beyond one cookie decode and a registry lookup that authentication already performed; the credential write happens only when the header is staged.
- `credentialExpiresAt` is an optional record field. Entries written by earlier builds carry none, and the panel keeps its previous display for them, so the record needs no migration and older builds ignore the field they do not read.
- A phone whose credential lapsed while it was closed still pairs again; the credential that phone lost is not recoverable, and the panel reports that state before the operator tries to extend the window.

## Testing

- `packages/client/connection/tests/browser-auth.host.spec.ts` pins the issuance report, the renewal on an authenticated request, the missing renewal for an aligned credential, a launch-token cookie, a request with no cookie, and a shortened window, and that a lapsed credential is never renewed.
- `packages/client/connection/tests/node-half.host.spec.ts` mounts the real `apply`, records the credential the pairing handshake issues, extends that device's window, and asserts the aligned `Set-Cookie` and the recorded `credentialExpiresAt` after an `/api` request that is not a document load.
- `packages/client/connection/tests/devices.host.spec.ts` pins the record field's round trip, its validation, the idempotent write, and its survival through a bin-and-restore cycle; `packages/bundle/mob/tests/panel.client.spec.tsx` pins the three panel states.

## Related

- [Per-device device lifetime](../feature/2026-09-13-device-lifetime-authority.md) remains the authority for the registry window, `setDeviceLifetime`, and the index-request refresh this note widens; [phone device pairing](../feature/2026-09-12-phone-device-pairing.md) remains the authority for how a phone is admitted.
