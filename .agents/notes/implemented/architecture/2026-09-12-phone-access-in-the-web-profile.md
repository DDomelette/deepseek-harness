# Agent Note: Phone access in the web profile

Status: implemented

English | [中文](2026-09-12-phone-access-in-the-web-profile.zh.md)

## Problem

Phone access to the Web GUI first shipped as its own `dsh mob` profile: a bundle patch rebound the webserver to all interfaces — outside the `--allow-lan` acknowledgement that guards the CLI path — and a terminal announcer printed the token-bearing join URL as a QR code. That made one capability into two entry points with different security postures, two sets of documentation, and a rebind that no flag gate could see.

## Decision

The phone-access layer rides the `web` profile. `PROFILE_TEMPLATES.web.bundles` composes `@deepseek-ai/dsh-mob` after `@deepseek-ai/dsh-web-app`; no `mob` profile exists and the CLI has no `mob` alias. Serving on the LAN is `dsh web --host 0.0.0.0 --allow-lan` and nothing else, so the acknowledgement, the plain-HTTP warning, and the readiness line all belong to one path.

What the layer contributes is unchanged in kind but narrower in scope: the `web`-profile settings entry `Settings → General → Connect phone` and the `mob` Remote namespace behind it (`mob.joinUrl`), which compose the LAN origin, and the pairing link the panel renders on it, from the fence snapshot. Registering it is the plugin's whole job: `packages/bundle/mob/cordis.patch.yml` inserts its row and patches nothing, and the host half writes no terminal output. The terminal QR path and its `qrcode-terminal` dependency are gone, and the settings entry is the only join surface.

The bundle keeps its `@deepseek-ai/dsh-mob` package name; the plugin name is `mob-join`, which states what it does now.

## Alternatives considered

- **Keep `dsh mob` as a thin alias for `dsh web --allow-lan`.** Rejected: the capability never shipped in a release, so no installed base needs the alias, and an alias is a second entry point that must stay semantically identical, documented, and tested forever. The two-line shell function that a developer wants during debugging belongs in that developer's shell profile, not in the CLI.
- **Keep the terminal QR behind an opt-in flag.** Rejected: the phone joins by scanning a code rendered in the Settings entry, and the terminal path would keep a QR dependency, its own TTY gating, and tests alive for a surface nobody uses.
- **Make the all-interfaces bind the default for `dsh web`.** Rejected: the LAN session is a bearer cookie over plaintext HTTP on a host that can execute commands, so defaulting it would turn that exposure into every user's starting state. `--allow-lan` stays the explicit acknowledgement, and a settings-level standing consent is deferred.

## Consequences

- An untouched installation-owned `web` tuple (`dsh-base` + `dsh-web-app`) is upgraded to the shipped template on the next profile load, so existing checkouts gain the layer without hand-editing; a profile whose bundle list differs in any other way is user-owned and stays untouched.
- A `$DSH_HOME/profiles/mob` directory created by an earlier `dsh mob` run is user-owned: no shipped template claims the name, and `dsh --profile mob` keeps booting that directory until the operator deletes it.
- The Settings entry reports `mob/loopback-only` on a loopback deployment and `mob/no-lan-address` when an all-interfaces bind derived no reachable address, which are the two corrections an operator can act on.
- Terminal output for the join URL is gone; the loopback URL line carrying the launch token, the token-free LAN URL line, and the plain-HTTP warning remain `dsh-web-app`'s readiness output.
