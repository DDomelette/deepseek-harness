---
description: "The dsh LAN phone-join layer for the web profile: the Settings entry that renders the token-bearing LAN URL as a QR code for a phone on the same network."
kind: "package-bundle"
---

# @deepseek-ai/dsh-mob

English | [中文](README.zh.md)

## Summary

Start `dsh web --host 0.0.0.0 --allow-lan` and open Settings → General → Connect phone to show a QR code a phone on the same network scans to join. The layer adds the join entry and the `mob` Remote namespace that answers it, on top of the `web` surface; the LAN bind, its warning, the token exchange, and signed-cookie authentication all remain `dsh web` behavior. Serving stays plain HTTP, so use it only on a network you trust.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Starting the LAN surface

```sh
dsh web --host 0.0.0.0 --allow-lan
dsh web --host 0.0.0.0 --allow-lan --port 8080
```

The `web` profile composes this bundle, so phone access is an ordinary `dsh web` capability: the readiness line prints the authenticated LAN URL next to the loopback one, and a phone on the same network opens it, completes the one-time token exchange, and receives the same signed cookie the loopback flow issues. `--allow-lan` is the explicit acknowledgement for serving on a trusted network; without it the all-interfaces bind stays a usage error.

### Handing off from a desktop session

The browser half adds a Connect phone row under Settings → General, which is the only join surface — nothing is printed to the terminal. The row opens a dialog that asks the Host for the token-bearing LAN URL through the `mob.joinUrl` Remote method and renders it as a QR code with the link below it. On a loopback-only deployment the call fails with `mob/loopback-only` and the dialog says LAN access is off; when an all-interfaces bind derived no reachable address it fails with `mob/no-lan-address` and the dialog asks for the machine's network instead, because the flag would not help there.

### What you get

Everything `dsh web` provides, plus the Connect phone entry and the `mob` Remote namespace behind it. The Web server, the LAN bind, its plain-HTTP warning, the browser-trust fence, and authentication stay owned by `dsh-host-webserver` and `dsh-web-app`; this layer patches nothing and writes no terminal output.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle is one insert-only patch plus one dual-face plugin. The patch adds the `mob-quick-join` row, which mounts this package's plugin with the `webServer` and `webRuntime` injections, and changes nothing else. The plugin's apply mounts one thing: `MobJoinController`, the Host service behind the `mob` Remote namespace whose `joinUrl` method serves the settings dialog.

### The fence LAN snapshot

The join URL comes from the `webRuntime` service — the same `resolveLanTrust` snapshot `dsh-web-app` feeds the `/api` trust fence — so the scanned URL always passes the fence. The first non-internal IPv4 literal becomes the QR target together with the bound port and the Connection-authenticated token; an empty (loopback-only) snapshot fails the call instead of printing a URL.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The `mob-quick-join` insert; it targets no existing row |
| [`src/index.ts`](src/index.ts) | The host half: mounts the `mob` Remote namespace and nothing else |
| [`src/join-url.ts`](src/join-url.ts) | The shared URL composer the Remote method calls |
| [`src/controller.ts`](src/controller.ts) | `MobJoinController`: the `mob` Remote namespace's `joinUrl`, classifying an empty snapshot as `mob/loopback-only` or `mob/no-lan-address` |
| [`src/types.ts`](src/types.ts) | The `mob` failure-code declarations (`mob/loopback-only`, `mob/no-lan-address`), shared by both faces |
| [`src/pairing.ts`](src/pairing.ts) | The pairing sessions: eight-character codes with a two-minute life, one decision each, and per-source throttling |
| [`src/client/`](src/client/index.ts) | The browser half: Connect-phone row, QR dialog, and the `settings.mobile` dictionaries |
| — | No runtime invariant companion is published; every observable effect is derived per call from the fence snapshot (see Invariant ownership below). |
| [`tests/mob.spec.ts`](tests/mob.spec.ts) | Host half: namespace registration, join answer, disposal |
| [`tests/web-profile-composition.spec.ts`](tests/web-profile-composition.spec.ts) | The real Loader-composed `web` profile: the LAN URL, `mob/loopback-only`, and `mob/no-lan-address` |
| [`tests/join-url.spec.ts`](tests/join-url.spec.ts) | The URL composer and the `joinUrl` Remote method, LAN and loopback paths |
| [`tests/pairing.spec.ts`](tests/pairing.spec.ts) | Pairing sessions: codes, approval, expiry, single use, and throttling |
| [`tests/apply.client.spec.ts`](tests/apply.client.spec.ts) | Row registration, deferred slot declaration, injected `joinUrl`, disposal |
| [`tests/row.client.spec.tsx`](tests/row.client.spec.tsx) | The row and dialog: load, QR render, loopback copy, close and reopen |

### Invariant ownership

No invariant companion is published because the plugin's observable effect — the `mob.joinUrl` answer, derived from the fence snapshot on each call — leaves no cached state a second observer could diverge from, and the Remote artifact wiring is validated at build time by the Typert generator.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when you want to go deeper into the surface this layer extends or the security decision behind it.

- [dsh-web-app](../web-app/README.md) — the browser surface this layer extends.
- [Bundle package map](../README.md) — the surfaces built on the same core.
- [LAN Web serving note](../../../.agents/notes/implemented/architecture/2026-09-11-lan-web-serving.md) — the LAN-serving security decision, the startup warning, and cookie revocation.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the composed `dsh-web-app` rows and session presets, which own every model-facing registration; this layer's browser half renders one settings entry and reaches the model in no way.

#### KV Cache effect

The bundle adds no request prefix of its own; the cache effect is unchanged from the `web` surface.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits tell you what to expect on untrusted networks or unusual terminals. They are current package constraints, not a task backlog.

- **LAN serving is plain HTTP** — anyone on the network who obtains the session cookie gains full control, so bind all interfaces only on a trusted network; the startup warning and the revocation path live in the [LAN Web serving note](../../../.agents/notes/implemented/architecture/2026-09-11-lan-web-serving.md).
- **LAN plain HTTP is not a secure context** — a phone browser gets no `navigator.serviceWorker` over plaintext LAN HTTP, so the service worker never registers and Android shows no install prompt; iOS reliably honors `apple-mobile-web-app-capable` for add-to-home-screen. The complete install experience is deferred to later TLS work.
- **iOS home-screen apps get no background WebSocket** — iOS suspends the app while it is in the background, so returning to the foreground recovers the stream through the existing Connection generation reconnect and the Remote journal stream's resume cursor.
- **LAN addresses are sampled once at startup** — a network change after boot is not reflected in the join URL; restart `dsh web` to sample the network again.
- **Virtual adapters sort after physical ones** — VPN/proxy virtual NICs (Clash TUN, VMware host-only nets, WSL, Docker bridges) are recognized by interface name and deprioritized, and the 198.18.0.0/15 fake-ip and 169.254.0.0/16 link-local ranges are excluded outright; the readiness line prints the remaining candidates, and if the QR address is still wrong, look up the real LAN IP with `ipconfig`/`ip addr` and replace the host part of the URL.
- **A loopback-only bind serves no join URL** — the Connect phone dialog fails with `mob/loopback-only` and names the flag to add; the `dsh-web-app` readiness line stays the only printed URL.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
