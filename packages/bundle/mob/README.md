---
description: "The dsh LAN phone-join layer: serves the Web UI on all network interfaces and prints a scan-to-join QR code, for users opening a session to a phone on the same network."
kind: "package-bundle"
---

# @deepseek-ai/dsh-mob

English | [中文](README.zh.md)

## Summary

Run `dsh mob` to serve the dsh Web UI on your LAN and print a terminal QR code a phone scans to join. The layer rebinds the Web server to all network interfaces and adds a QR announcer row on top of the `web` surface; the token exchange and signed-cookie authentication are unchanged from `dsh web`. Serving stays plain HTTP, so use it only on a network you trust. Choose this layer for phone access; use `dsh web` for loopback-only browsing.

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
dsh mob
dsh mob --port 8080
```

The shipped `mob` profile layers this bundle over `dsh-web-app`, so startup is the `dsh web` flow with two additions: the server binds all network interfaces, and once the plugin tree settles the terminal prints a `dsh mob:` line carrying the token-bearing LAN URL plus a scannable QR code. A phone on the same network opens that URL, completes the one-time token exchange, and receives the same signed cookie the loopback flow issues. The loopback URL and browser handoff remain `dsh-web-app`'s readiness output and still work from this machine.

### Handing off from a desktop session

The bundle's browser half adds a Connect phone row under Settings → General. The row opens a dialog that asks the Host for the same token-bearing LAN URL through the `mob.joinUrl` Remote method and renders it as a QR code with the link below it, so a phone joins without anyone reading the terminal. On a loopback-only deployment the call fails with `mob/loopback-only` and the dialog says LAN access is off; when an all-interfaces bind derived no reachable address it fails with `mob/no-lan-address` and the dialog asks for the machine's network instead, because starting the mobile profile would not help there.

### What you get

Everything `dsh web` provides, plus an all-interfaces bind with a mount-time plain-HTTP warning on stderr, and the `mob-quick-join` QR announcer. The Web server, the browser-trust fence, and authentication stay owned by `dsh-host-webserver` and `dsh-web-app`; invocation flags such as `--port` keep working through the same `webStartup` expressions. Command-line `--host 0.0.0.0` on other surfaces still requires `--allow-lan`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle is one patch plus one dual-face plugin. The patch restates the `webserver` row's whole config with an all-interfaces default host — a patch replaces the targeted row's whole `config`, so the row restates every key it owns — and inserts the `mob-quick-join` row, which mounts this package's plugin with the `webServer` and `webRuntime` injections. The plugin's apply mounts two things: the terminal QR announcer, and `MobJoinController`, the Host service behind the `mob` Remote namespace whose `joinUrl` method serves the settings dialog.

### Readiness and reprint rules

The QR announcer mirrors `dsh-web-app`'s readiness row: it waits for Loader settlement (a hand-built tree without a Loader announces at once), prints nothing when the boot fails or the tree is torn down mid-boot, and prints nothing on a loopback-only bind or non-TTY stdout. Connection hot reloads must not reprint, so announced roots are remembered process-wide.

### The fence LAN snapshot

The announced address comes from the `webRuntime` service — the same `resolveLanTrust` snapshot `dsh-web-app` feeds the `/api` trust fence — so the scanned URL always passes the fence. The first non-internal IPv4 literal becomes the QR target together with the bound port and the Connection-authenticated token; an empty (loopback-only) snapshot prints nothing. The announcer and the `mob.joinUrl` Remote method compose the URL through the same `resolveJoinUrl` helper, so the terminal and the settings dialog never drift apart.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The LAN rebind of the `webserver` row plus the `mob-quick-join` insert |
| [`src/index.ts`](src/index.ts) | The host half: mounts the `mob` Remote namespace and nothing else |
| [`src/join-url.ts`](src/join-url.ts) | The shared URL composer the Remote method calls |
| [`src/controller.ts`](src/controller.ts) | `MobJoinController`: the `mob` Remote namespace's `joinUrl`, classifying an empty snapshot as `mob/loopback-only` or `mob/no-lan-address` |
| [`src/types.ts`](src/types.ts) | The `mob` failure-code declarations (`mob/loopback-only`, `mob/no-lan-address`), shared by both faces |
| [`src/client/`](src/client/index.ts) | The browser half: Connect-phone row, QR dialog, and the `settings.mobile` dictionaries |
| — | No runtime invariant companion is published; every observable effect is derived per call from the fence snapshot, and the announced-roots set is private state no second observer can diverge from (see Invariant ownership below). |
| [`tests/mob.spec.ts`](tests/mob.spec.ts) | Host half: namespace registration, silence, disposal |
| [`tests/join-url.spec.ts`](tests/join-url.spec.ts) | The URL composer and the `joinUrl` Remote method, LAN and loopback paths |
| [`tests/apply.client.spec.ts`](tests/apply.client.spec.ts) | Row registration, deferred slot declaration, injected `joinUrl`, disposal |
| [`tests/row.client.spec.tsx`](tests/row.client.spec.tsx) | The row and dialog: load, QR render, loopback copy, close and reopen |

### Invariant ownership

No invariant companion is published because the plugin's observable effects — console output after Loader settlement and the `mob.joinUrl` answer, both derived from the same fence snapshot on each call — leave no cached state a second observer could diverge from; the announced-roots set is private and the Remote artifact wiring is validated at build time by the Typert generator.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when you want to go deeper into the surface this layer extends or the security decision behind it.

- [dsh-web-app](../web-app/README.md) — the browser surface this layer rebinds and extends.
- [Bundle package map](../README.md) — the surfaces built on the same core.
- [LAN Web serving note](../../../.agents/notes/implemented/architecture/2026-09-11-lan-web-serving.md) — the LAN-serving security decision, the startup warning, and cookie revocation.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the composed `dsh-web-app` rows and session presets, which own every model-facing registration; the QR announcer prints only to the terminal.

#### KV Cache effect

The bundle adds no request prefix of its own; the cache effect is unchanged from the `web` surface.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits tell you what to expect on untrusted networks or unusual terminals. They are current package constraints, not a task backlog.

- **LAN serving is plain HTTP** — anyone on the network who obtains the session cookie gains full control, so bind all interfaces only on a trusted network; the mount-time warning and the revocation path live in the [LAN Web serving note](../../../.agents/notes/implemented/architecture/2026-09-11-lan-web-serving.md).
- **LAN plain HTTP is not a secure context** — a phone browser gets no `navigator.serviceWorker` over plaintext LAN HTTP, so the service worker never registers and Android shows no install prompt; iOS reliably honors `apple-mobile-web-app-capable` for add-to-home-screen. The complete install experience is deferred to later TLS work.
- **iOS home-screen apps get no background WebSocket** — iOS suspends the app while it is in the background, so returning to the foreground recovers the stream through the existing Connection generation reconnect and the Remote journal stream's resume cursor.
- **LAN addresses are sampled once at startup** — a network change after boot is not re-announced; restart the surface to re-advertise.
- **Virtual adapters sort after physical ones** — VPN/proxy virtual NICs (Clash TUN, VMware host-only nets, WSL, Docker bridges) are recognized by interface name and deprioritized, and the 198.18.0.0/15 fake-ip and 169.254.0.0/16 link-local ranges are excluded outright; the readiness line prints the remaining candidates, and if the QR address is still wrong, look up the real LAN IP with `ipconfig`/`ip addr` and replace the host part of the URL.
- **Loopback-only binds and non-TTY stdout print no QR** — supervisors and loopback deployments get no announcement; the `dsh-web-app` URL line remains the readiness signal.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
