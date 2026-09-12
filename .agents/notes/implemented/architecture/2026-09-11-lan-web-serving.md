# Agent Note: LAN Web serving behind an explicit --allow-lan

Status: implemented

English | [中文](2026-09-11-lan-web-serving.zh.md)

## Problem

Operating the Web UI from a phone requires reaching the Host over the LAN, but the shipped CLI refused `--host 0.0.0.0` outright: the `/api` surface includes remote-code-execution-grade methods, and neither the [browser-trust fence](2026-07-28-api-browser-trust-boundary.md) nor [browser token authentication](2026-08-24-browser-token-authentication.md) was designed to imply supported network deployment. Mobile access was impossible without an operator-maintained proxy, even on a trusted home network where the risk is acceptable.

## Decision

`dsh web` accepts `--host 0.0.0.0` only together with an explicit `--allow-lan` flag (`dsh-web-app/startup`); without it the invocation remains a usage error naming the flag. Binding all interfaces prints a stderr warning at mount time: plain HTTP means anyone on the network who obtains the session cookie gains full control, so the mode is for trusted networks only. The trust fence and token authentication are unchanged: `resolveLanTrust` derives the machine's LAN IP literals into `trustedHosts`, so the LAN authority passes the Host fence while every API call still requires the launch-token-exchanged cookie, which is authority-bound to the LAN host and port. Derivation excludes the 198.18.0.0/15 fake-ip range (RFC 2544 benchmarking, hijacked by Clash-style TUN stacks) and the 169.254.0.0/16 link-local range (an interface that never completed DHCP) from both display and fence, and stable-sorts virtual/tunnel adapters (VMware, WSL, Docker, TUN/TAP VPNs, WireGuard, Tailscale, ZeroTier, matched by interface name) after physical ones, so the printed and scanned address is one a phone can reach; virtual addresses remain in the result for virtual-only deployments, and the readiness line prints every other candidate because the ordering is a name heuristic.

The `web` profile composes the phone-access bundle (`@deepseek-ai/dsh-mob`), so LAN serving is the CLI path above and only that path: the bundle patches nothing, `--allow-lan` governs every invocation, and the mount-time stderr warning accompanies the bind. [Phone access in the web profile](2026-09-12-phone-access-in-the-web-profile.md) owns that layer's decision.

The `mob` bundle also carries a browser half: a Connect phone row under Settings → General opens a QR dialog that calls the `mob.joinUrl` Remote method, which hands the already-authenticated client the token-bearing LAN URL the readiness line prints, composed from the same fence snapshot through the shared `resolveJoinUrl` helper. An empty snapshot fails with `mob/loopback-only` on a loopback bind and with `mob/no-lan-address` when an all-interfaces bind derived no reachable address, because the two corrections differ (enable the LAN bind, or fix this machine's networking).

## Alternatives considered

- **Keep the blanket refusal; document a reverse proxy.** Rejected: a proxy asks every mobile user to run extra infrastructure for a deployment the fence and authentication already secure to the level the loopback deployment has.
- **Drop the guard entirely once authentication exists.** Rejected: a bare `--host 0.0.0.0` reads like a routine bind option; the explicit flag makes the security-relevant choice visible at the call site, and the stderr warning states the residual plaintext risk on every start.
- **TLS by default for LAN serving.** Rejected for this change: certificate provisioning on phones has no maintained path in the repo today; the cookie lacks `Secure` by loopback-era design, and adding TLS is a separate deployment contract.

## Consequences

- A phone on the network joins by opening the printed LAN URL (or scanning the QR code the Connect phone entry renders); the one-time token exchange issues the same signed cookie the loopback flow uses.
- `mob.joinUrl` hands a fresh token URL to a client that already holds the session cookie, so it widens no attack surface: a cookie holder already has full Host API authority.
- Residual risk: token exchange and every authenticated request travel in plaintext; a network attacker who steals the cookie holds it until expiry or until the `client-connection/browser-session` grant record is deleted and the process restarts (the existing global revocation).
- The two predecessor notes remain active authority for the fence and for authentication; this note supersedes only their "the CLI rejects `--host 0.0.0.0`" consequence statements.
