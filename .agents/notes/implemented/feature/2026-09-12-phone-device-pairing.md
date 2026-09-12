# Agent Note: Phone device pairing

Status: implemented

English | [中文](2026-09-12-phone-device-pairing.zh.md)

## Problem

A phone reached the Web GUI by opening the URL `dsh web` prints for the computer itself: the process token travels in that URL, the exchange writes the same authority-bound browser cookie the computer holds, and the cookie is valid for the deployment's full `cookieMaxAgeDays`. Whoever sees that URL — a screenshot, a shared clipboard, a shoulder — holds the computer's own session, and no operation ends one phone's access without rotating the signing secret and logging the computer out too. Nothing in the deployment distinguishes one phone from another, so the operator cannot tell which device is connected, let alone revoke it.

## Decision

A phone is admitted as a *paired device* rather than as a copy of the computer's session.

The computer opens a request with `POST /pair/session`, which answers an eight-character code from an alphabet without `0/O` and `1/I`, valid for 120 seconds and usable once. The phone claims it by opening `/pair?c=<code>`; the polling screen reads `/pair/state`, and both of the phone's routes accept a request that holds no cookie — the phone has none yet. Every other pairing route (`/pair/session`, `/pair/requests`, `/pair/approve`, `/pair/devices`, `/pair/revoke`) requires the browser session *and* a loopback authority, so the only party that can admit a device is a person sitting at the computer.

An approval registers the device under a label derived from the phone's user agent and editable in the panel, and the phone's next `/pair/state` poll answers with a device cookie plus the decision. That cookie is the second cookie form: payload `{version: 2, authority, deviceId, issuedAt, expiresAt}`, lifetime `deviceCookieMaxAgeDays` (default 180) fixed at issue and never renewed by use. `BrowserAuth.isAuthenticated` accepts it only while the `client-connection/paired-devices` credentials record still lists the device, so revocation ends that phone's access on its next request without restarting the Host or touching the computer's own cookie. The v1 launch-token cookie is unchanged, which keeps the loopback handoff exactly as it was.

`ctx.connection.devices` owns the registry — `list`, `register`, `revoke`, `touch` — and every mutation refreshes the running cookie check. `touch` advances a device's last-seen time at most once an hour, so ordinary requests do not rewrite the credential file. The pairing session itself is bounded three ways: a 32^8 code space, the 120-second lifetime, and per-source throttling (ten reads per ten seconds, and a 60-second lockout after five consecutive failed codes).

## Alternatives considered

- **Borrow the DeepSeek official login.** Rejected: dsh has no account system to authenticate against — settings hold an API key or a provider id, and the harness's own identity is the anonymous `~/.dsh/.anonymous-user-id` — there is no public third-party OAuth or OIDC endpoint to delegate a LAN browser to, and a login would not remove the plaintext window on the phone-to-computer leg. It would add an external dependency to a capability that needs no account at all.
- **Phone-number or SMS login.** Rejected: it needs an SMS provider, a user database, and a recovery story the harness does not have, for a deployment whose only legitimate users are the people in the room.
- **Keep the printed URL as the phone's credential, with a per-phone secret in the QR.** Rejected: a secret that is handed out the same way every time still cannot be revoked per device, and nothing distinguishes the phones that hold it.
- **Let a paired phone approve the next phone, or approve through `/api` Remote methods.** Rejected: a device that can admit devices makes possession of the LAN address sufficient to join, and it would move the decision onto a channel a phone can reach; the loopback requirement is the only available proof that someone is at the computer, so the settings panel speaks the same `/pair*` routes instead of adding Remote twins.
- **Sliding renewal of device cookies.** Rejected: a stolen cookie would stay alive for as long as it is used. A fixed lifetime plus explicit revocation is what the operator can reason about.

## Consequences

- `/pair` serves the application shell itself — through the `frontend` service `frontend-static` provides — carrying a `__DSH_PAIR__` boot fact; the phone's pairing screen renders over `shell.overlay` and leaves for `/` once the cookie arrives, so the phone runs the same application bundle as the computer.
- The phone-connected deployment now has two credential forms to reason about: the process launch token (loopback, unchanged, revoked by deleting `client-connection/browser-session`) and device cookies (LAN, revoked per device by `POST /pair/revoke`).
- Revocation is immediate for the running Host because each registry mutation refreshes the in-memory device set; a device record damaged beyond interpretation fails the operation loudly instead of being overwritten.
- The phone-to-computer leg is still plain HTTP: an observer on the network can read the pairing poll and the device cookie in transit, and the cookie carries no `Secure` attribute because the transport cannot honour one. TLS with a self-signed or mkcert certificate is the separate phase that would close that window and let the attribute be set.
- `apps/cli/tests/pairing.e2e.ts` drives the whole handshake through the real CLI: the code, the phone's unauthenticated screen, the loopback-only decision, the device cookie authenticating `/api`, a paired phone being refused a decision, revocation turning the same cookie into 401, and the per-source lockout.
- [LAN Web serving](../architecture/2026-09-11-lan-web-serving.md) stays the authority for the bind, the fence, and the plain-HTTP warning; this note owns who a phone is and how it is admitted. [Phone access in the web profile](../architecture/2026-09-12-phone-access-in-the-web-profile.md) stays the authority for the entry point.
