# Agent Note: Per-device device lifetime

Status: implemented

English | [中文](2026-09-13-device-lifetime-authority.zh.md)

## Problem

A paired phone's access ended when the signed device cookie said so: `issueDeviceCookie` wrote `expiresAt = issue time + deviceCookieMaxAgeDays`, the shipped default was 180 days, and `BrowserAuth` accepted the cookie for as long as its payload allowed and the registry still listed the device. The registry entry carried only `{id, label, registeredAt, lastSeenAt}`, so it answered one question — is this device still allowed — and the only lever over a phone's window was revoking it and pairing again. An operator who wanted a shorter window for a phone that leaves the house, or a longer one for a device that stays on the desk, had no way to say so, and the 180-day default outlived any plausible review of it.

## Decision

The `client-connection/paired-devices` record is the authority for each device's delivery window. An entry gains two optional fields: `lifetimeDays` (the operator's policy) and `expiresAt` (epoch milliseconds the current window ends). A device cookie is accepted when its signature is valid, the registry still lists that device, and the current time is before that device's window end — the registry's `expiresAt` when the entry carries one, otherwise the expiry in the signed payload, which is what an entry approved before this change keeps running on. Registration writes both fields from `deviceLifetimeDays` (default 30, integer 1–365, no never-expires option), so a new device is registry-governed from its first request.

`setDeviceLifetime` writes `lifetimeDays` with `expiresAt = now + days * DAY_MILLISECONDS`, so setting a window restarts that device's countdown. A shortened window needs nothing else: the registry refuses the device on its next request. An extended window reaches the phone through its next index request, which re-issues a device cookie aligned with the registry — payload expiry and `Max-Age`/`Expires` together — because a cookie payload can never outlive the window the registry records. Ordinary `/api` requests never renew anything, so the renewal path stays one route deep instead of spreading across every call.

Legacy entries are never written back. Reading the record does not migrate it, the panel shows `—` for an entry with no window, and the row's lifetime controls are how an operator moves that device onto the registry model; until then the device behaves exactly as it did before this change, so upgrading the Host does not drop a phone that is already paired.

The panel owns the operator surface: a lifetime column per device, `1`/`7`/`30`/`90` day presets plus an arbitrary-days box that restart the countdown, and a guidance line that says to revoke a device that is no longer used and to revoke after using an untrusted network. Its third computer-only route, `POST /pair/devices/lifetime` with `{deviceId, days}`, carries the write behind the same loopback-authority and browser-session guard as `/pair/approve`, `/pair/revoke`, and `GET /pair/devices`, so a phone cannot re-schedule itself or another device. `GET /pair/devices` answers each device with its stored `lifetimeDays` and `expiresAt`.

The startup warning for an all-interfaces bind keeps its wording and names the two narrowings: admit only the paired phone through the firewall, or pass `--host 127.0.0.1`.

## Alternatives considered

- **Keep the cookie payload as the authority and renew it on use.** Rejected: a stolen cookie would extend its own life for as long as it is used, which is the property the fixed 180-day window was chosen for, and it would re-introduce the renewal path on every request.
- **Write `expiresAt` back for legacy entries the first time the record is read.** Rejected: a read that writes makes the credential file change under an operator who only opened the panel, and it would start the clock on devices whose cookies were issued under the old policy — a silent logout for phones that were merely idle.
- **Offer a never-expires option for a device that stays at home.** Rejected: the LAN leg is plain HTTP, so the cookie is readable in transit; a permanent shell-equivalent credential on that leg has no recovery path short of revoking the device, and 365 days already covers the legitimate long-lived case.
- **Refresh the cookie on every authenticated `/api` request instead of the index request.** Rejected: it puts credential-provider and registry work on the RPC hot path, and it would extend a phone's window without the operator's knowledge on any stray request; one page load is the whole cost of the index-only rule.
- **Make the lifetime a per-deployment value instead of a per-device fact.** Rejected: it cannot shorten one phone without shortening every phone, which is the case that motivated the change, and the registry entry already travels with the device it describes.

## Consequences

- A device cookie's maximum life is now the window the operator last set, bounded by 365 days; `deviceCookieMaxAgeDays` is deleted and no configuration value replaces it per device.
- Windows change on the phone's next page load when extended; a phone that holds a stale cookie keeps working until its payload expires, and then it must load a page to pick up the extension.
- A legacy entry keeps its payload-bounded life until an operator sets days for it, at which point that device switches to the registry model; the panel's `—` is the visible marker of that state.
- The per-device window is a fact in `client-connection/paired-devices`, so it travels with the credentials file and is not reproducible from configuration alone.
- The plaintext LAN leg is unchanged. This narrows the value of a stolen cookie rather than removing the exposure; TLS remains the separate phase that closes it.
- [Phone device pairing](2026-09-12-phone-device-pairing.md) remains the authority for who a phone is and how it is admitted; [browser launch-token authentication](../architecture/2026-08-24-browser-token-authentication.md) remains the authority for the launch-token cookie and the signing record.
