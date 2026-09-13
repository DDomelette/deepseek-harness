# Agent Note: Every interface is the default bind for dsh web

Status: implemented

English | [中文](2026-09-13-lan-bind-by-default.zh.md)

## Problem

Reaching the Web GUI from a phone requires the Host to listen on the LAN, and that used to require typing `dsh web --host 0.0.0.0 --allow-lan` on every start: the composed host default was `127.0.0.1`, and naming the all-interfaces host without the acknowledgement flag was a usage error. This deployment starts the GUI several times a day from a shell, and those two flags were the only reason the Connect-phone entry kept reporting `mob/loopback-only` with instructions to type them. [LAN Web serving](2026-09-11-lan-web-serving.md) owns the fence, the warning, and the history of that acknowledgement; [phone access in the web profile](2026-09-12-phone-access-in-the-web-profile.md) owns the entry point.

## Decision

`dsh web` binds `0.0.0.0` when the invocation names no host. The deployment fallback in the web profile's webserver row is `0.0.0.0`, so a bare `dsh web` serves the LAN, prints the token-free LAN URL on the readiness line, and leaves the Connect-phone entry usable.

`--host 127.0.0.1` is the opt-out: it binds loopback only, prints no LAN line, and makes the pairing entry report that LAN access is off (`mob/loopback-only`). `--allow-lan` is still accepted and documented as redundant, so commands written against the previous default keep working.

Every other rule is unchanged. The launch token is exchanged on a loopback authority only, a LAN browser authenticates with the device cookie it earns by pairing, the Host/Origin fence still decides which authorities are trusted, and binding every interface still prints the plain-HTTP warning at mount time.

## Alternatives considered

- **Keep the acknowledgement flag.** Rejected for this deployment: the operator accepted the LAN exposure when choosing to serve the GUI on a home network, and repeating the acknowledgement on every start made the phone entry read as broken rather than as protected.
- **A profile-level standing consent.** Rejected as a step nobody here needed: it adds a config field and a second decision point, plus a "why is LAN off" failure mode, for the sake of a flag this deployment never omits.
- **A shell alias instead of a product default.** Rejected: it hides the choice in one operator's shell profile, so every other invocation — a script, a second checkout, a packaged install — keeps the loopback default and the phone entry keeps reporting itself off.

## Consequences

- [LAN Web serving](2026-09-11-lan-web-serving.md) remains the authority for the bind, the fence, and the plain-HTTP warning; its acknowledgement flag is now the redundant form rather than the required one.
- [Phone access in the web profile](2026-09-12-phone-access-in-the-web-profile.md) recorded "make the all-interfaces bind the default for `dsh web`" as rejected; this note adopts that alternative.
- The exposure is the starting state: any `dsh web` on this machine serves the LAN over plain HTTP, and the mount-time warning is the only notice. `--host 127.0.0.1` is the documented way back, and the pairing entry names it when the operator takes it.
- This is a deployment-local default, so it diverges from the upstream decision the two linked notes record; a deployment that wants the acknowledgement back passes `--host 127.0.0.1`.
