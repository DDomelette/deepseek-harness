# Agent Note: Phone access in the web profile

Status: implemented

English | [中文](2026-09-12-phone-access-in-the-web-profile.zh.md)

## Problem

Phone access needs the same listener, browser authentication, and Host/Origin checks as the Web GUI. A separate phone launcher or a browser-hostname permission check can disagree with those owners: an operator authenticated on a LAN authority must be able to approve a phone, while a paired phone must not manage devices.

## Decision

The shipped `web` profile composes `@deepseek-ai/dsh-mob` after `@deepseek-ai/dsh-web-app`. Its insert-only patch registers the settings entry, the `mob` Remote namespace, and the pairing routes; it changes no listener or authentication policy. The [concrete bind decision](2026-09-19-concrete-web-bind-address.md) owns the loopback default and the explicit interface selection.

The token-free join root prefers `--public-url`, then the first `--trusted-host` with its explicit port or the listener's port, then the concrete non-loopback bind address. The listener supplies the transport. A loopback or zoned non-loopback listener without an advertised authority reports `mob/no-advertised-origin`; the settings notice names `dsh web --host <LAN-IP>` and `--public-url`. No interface discovery extends trust.

The pairing panel reads the operator-only device list before exposing controls or polling requests. Success grants the management view; a forbidden result explains the required launcher credential, and a transient read failure offers Retry. The browser's hostname grants no permission. Connection authenticates every management route, so a declared LAN authority carrying the launch-token cookie can manage pairing and a paired-device cookie cannot.

The panel resolves the join root before creating a short code. A missing address creates no unusable pairing session. Device refresh failures retain the displayed list.

## Alternatives considered

- **A separate phone profile or launcher alias.** Rejected: it duplicates startup and security decisions. Phone access belongs to the Web profile.
- **Default wildcard binding or inferred LAN trust.** Rejected: the operator names the concrete interface to expose; the phone plugin must not broaden that choice.
- **A client hostname gate or another permission service.** Rejected: the existing authenticated management route already owns the decision and distinguishes operator cookies from device cookies.

## Consequences

The operator starts `dsh web --host <LAN-IP>`, opens the authenticated URL printed by the launcher, and approves the phone in Settings → General → Connect phone. Ordinary `dsh web` remains local by default. A proxy can advertise its root through `--public-url` and declare its authority through `--trusted-host`.

Package tests cover URL composition, permission reads, failure recovery, and Loader disposal. The browser scenario exercises a non-loopback authority with separate operator and phone contexts and records the permission and missing-address notices beside its owning test.
