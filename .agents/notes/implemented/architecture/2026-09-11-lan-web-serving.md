# Agent Note: LAN Web serving behind an explicit --allow-lan

Status: implemented

English | [中文](2026-09-11-lan-web-serving.zh.md)

## Problem

Operating the Web UI from a phone requires reaching the Host over the LAN, but the shipped CLI refused `--host 0.0.0.0` outright: the `/api` surface includes remote-code-execution-grade methods, and neither the [browser-trust fence](2026-07-28-api-browser-trust-boundary.md) nor [browser token authentication](2026-08-24-browser-token-authentication.md) was designed to imply supported network deployment. Mobile access was impossible without an operator-maintained proxy, even on a trusted home network where the risk is acceptable.

## Decision

`dsh web` accepts `--host 0.0.0.0` only together with an explicit `--allow-lan` flag (`dsh-web-app/startup`); without it the invocation remains a usage error naming the flag. Binding all interfaces prints a stderr warning at mount time: plain HTTP means anyone on the network who obtains the session cookie gains full control, so the mode is for trusted networks only. The trust fence and token authentication are unchanged: `resolveLanTrust` derives the machine's LAN IP literals into `trustedHosts`, so the LAN authority passes the Host fence while every API call still requires the launch-token-exchanged cookie, which is authority-bound to the LAN host and port.

The `mob` shipped profile (`@deepseek-ai/dsh-mob` layered on `dsh-web-app`) sets `host: 0.0.0.0` through its bundle patch config — a path that never parses CLI flags, so the `--allow-lan` guard does not apply and the mount-time stderr warning carries the safety notice for both paths.

## Alternatives considered

- **Keep the blanket refusal; document a reverse proxy.** Rejected: a proxy asks every mobile user to run extra infrastructure for a deployment the fence and authentication already secure to the level the loopback deployment has.
- **Drop the guard entirely once authentication exists.** Rejected: a bare `--host 0.0.0.0` reads like a routine bind option; the explicit flag makes the security-relevant choice visible at the call site, and the stderr warning states the residual plaintext risk on every start.
- **TLS by default for LAN serving.** Rejected for this change: certificate provisioning on phones has no maintained path in the repo today; the cookie lacks `Secure` by loopback-era design, and adding TLS is a separate deployment contract.

## Consequences

- A phone on the network joins by opening the printed LAN URL (or scanning the QR code the `mob` profile prints); the one-time token exchange issues the same signed cookie the loopback flow uses.
- Residual risk: token exchange and every authenticated request travel in plaintext; a network attacker who steals the cookie holds it until expiry or until the `client-connection/browser-session` grant record is deleted and the process restarts (the existing global revocation).
- The two predecessor notes remain active authority for the fence and for authentication; this note supersedes only their "the CLI rejects `--host 0.0.0.0`" consequence statements.
