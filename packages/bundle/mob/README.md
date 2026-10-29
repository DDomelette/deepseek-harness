---
description: "The dsh LAN phone-join layer for the web profile: the Settings entry that pairs a phone through a one-time code and manages the devices it approved."
kind: "package-bundle"
---

# @deepseek-ai/dsh-mob

English | [中文](README.zh.md)

## Summary

Start `dsh web --host <LAN-IP>` and open Settings → General → Connect phone to pair a phone on the same network: the panel opens a one-time code, renders the `/pair?c=<code>` link as a QR code beside it, and decides what each requesting phone may become. The layer adds the join entry and the `mob` Remote namespace that answers it, on top of the `web` surface; the LAN bind, its warning, the operator-token exchange, and signed-cookie authentication all remain `dsh web` behavior. The listener supports HTTP and configured TLS; use plain HTTP only on a trusted network.

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
dsh web
dsh web --host 192.168.1.5
dsh web --host 192.168.1.5 --port 8080
```

The `web` profile composes this bundle. Plain `dsh web` binds loopback only; for a phone on the same network, pass `--host` with the computer’s concrete LAN IP, as in the example above. Wildcard addresses such as `0.0.0.0` are refused. Open the authenticated URL printed by the launcher on the computer, then open Settings → General → Connect phone. A direct bind-IP URL needs no duplicate `--trusted-host`; a proxy declares its browser-facing root with `--public-url` and its authority with `--trusted-host`. Keep the launcher token on the computer: the phone earns its own device cookie through pairing.

### Handing off from a desktop session

The browser half adds a Connect phone row under Settings → General, which is the only join surface — nothing is printed to the terminal. The row opens the pairing panel: *Create pairing code* asks the Host for a code through `POST /pair/session`, composes the token-free `/pair?c=<code>` link on the deployment's advertised origin, and renders that link as a QR code beside the code and the seconds it has left. The panel then lists the requests waiting for a decision — a minted code enters the list only once a phone claims it on the pairing page, so *Allow* can never register a device no phone holds; each entry carries the device name derived from the phone's agent, editable before *Allow* or *Deny* — and the devices already paired, each row carrying an editable name, the MAC address the ARP table resolved for the claiming phone when it could, when the device was added, when it last authenticated, and a *Revoke credential* button that moves the device to the recycle bin: its access ends on its next request, while the entry stays restorable until the operator deletes it for good. The panel first reads the operator-only device list: success enables management, a forbidden response explains the required launcher credential, and a transient read failure offers Retry. An authenticated operator on a LAN authority can manage pairing; a paired phone cannot. Without a phone address, `mob/no-advertised-origin` names the concrete `--host` or advertised `--public-url` to configure, and no short code is created. Every control speaks the same `/pair*` routes the phone uses, so the local-operator authentication rule that guards a decision has one enforcement point. Decisions and device actions run one at a time: a click that lands while one is already in flight is ignored, so a double click cannot be reported as a failure, a later success clears the failure notice, and an answered request leaves the list immediately. Each paired device row also carries its lifetime: `{days} days ({remaining} days left)`, `{days} days ({remaining} days left on the phone)` while the phone still holds a shorter credential that its next request renews, `Credential expired — pair again` once the credential that phone actually holds has passed, `Expired` once the window has passed, or `—` for an entry that predates per-device lifetimes and still runs on the expiry its cookie carries. The row's *Credential lifetime* dropdown — `1`/`7`/`30`/`90` day presets with a *Custom…* entry for any other day count — restarts that device's countdown, a shorter window applies to that phone's next request, and a longer one renews that phone's credential on its next request, while its current cookie is still valid — a credential that already lapsed must pair again. A line above the list says to revoke a device you no longer use or one that saw an untrusted network, and that a revoked device rests in the recycle bin, where it can be restored or deleted for good.

### Pairing a phone

`POST /pair/session` opens a request and answers with an eight-character code that lives two minutes. The phone opens `/pair?c=<code>`, which serves the application shell carrying the `__DSH_PAIR__` boot fact; the browser half registers a pairing screen over `shell.overlay` for that page, shows the code, and polls `/pair/state` every 1.5 seconds. Only a read that names no live code counts against the source's throttle — the session a screen is already polling is not a search — so two pages open on one phone cannot lock each other out of the pairing they are waiting on, and a source the search budget locked can still collect the decision for the code it holds. The moment the computer approves the request, that poll answers with the device cookie and the screen leaves for `/`, so the phone holds a session of its own instead of the computer's launch token; a denied, expired, or throttled code stops the polling and shows the copy that says what to do next, and the throttled copy asks for a minute's wait because a new code cannot help that source until the lockout lifts. `POST /pair/approve` carries the decision and the device label — an allowed decision also resolves the claiming phone's MAC address from the ARP table, a best-effort fingerprint a failed lookup simply omits, a row whose phone never collects its cookie is revoked and purged once its code expires, so an approval no device claimed leaves nothing behind, and a registration that fails reports the error and withdraws the decision so the operator can decide again instead of leaving the phone on a decision it can never collect — `GET /pair/requests` lists the claimed codes still waiting, `GET /pair/devices` lists what was approved, `POST /pair/devices/label` renames a device, `POST /pair/revoke` moves one device to the recycle bin — its access ends on its next request — `POST /pair/devices/restore` re-admits a binned device, and `POST /pair/devices/purge` deletes a binned device for good. `/pair` and `/pair/state` accept a phone that holds no cookie yet — they still pass the Host fence, and `/pair/state` alone carries the per-source throttling — while every other route requires a valid operator cookie accepted by Connection for that authority, so a phone on the LAN cannot approve itself. `POST /pair/devices/lifetime` carries `{deviceId, days}` and is, like the revoke, restore, and purge routes, a computer-only decision route, so a phone cannot extend or shorten its own window or another device's; `GET /pair/devices` answers each device with its `lifetimeDays`, `expiresAt`, `credentialExpiresAt`, `macAddress`, and `revokedAt` when the entry carries them, which is what the panel's lifetime column and recycle bin render; a legacy entry reports neither window field.

The code must contain exactly eight characters from the generator's alphabet. `/pair` and `/pair/state` require exactly one `c` query parameter; malformed or duplicate codes return 400. The embedded boot JSON escapes `<` so a code cannot terminate its script element.

### Coming back after a revocation

A phone whose device was revoked — or whose cookie expired — reaches the Host without a session until the operator restores the device from the recycle bin or pairs it again. `frontend-static` then serves it the shell as a 401 carrying the `__DSH_AUTH_REQUIRED__` boot fact, and the browser half registers a session-required screen over `shell.overlay`: it states that this device's credential expired or was revoked, names the computer setting that creates a new code, and offers a reload button, which picks up a device cookie the phone earned in another tab. The screen renders where the Host refused the document and, on a page it accepted, as soon as the connection reports that credential's lapse — the collapsed rail a phone gets hides the sidebar's connection indicator, so this screen is the surface that states the reason there. A phone holding a working session never sees it, and the computer's own loopback page keeps the Connection-owned 401 that says to reopen the printed URL.

### What you get

Everything `dsh web` provides, plus the Connect phone entry and the `mob` Remote namespace behind it. The Web server, the LAN bind, its plain-HTTP warning, the browser-trust fence, and authentication stay owned by `dsh-host-webserver` and `dsh-web-app`; this layer patches nothing and writes no terminal output.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle is one insert-only patch plus one dual-face plugin. The patch adds the `mob-quick-join` row, which mounts this package's plugin with the `webServer` and `webStartup` injections, and changes nothing else. The plugin's apply mounts two things: `MobJoinController`, the Host service behind the `mob` Remote namespace whose `joinUrl` method serves the settings dialog, and the eleven `/pair*` named routes that carry the pairing handshake.

### The advertised origin

The join root prefers the deployment’s `--public-url`, then its first `--trusted-host`, then its concrete non-loopback listener. A trusted authority retains its explicit port; otherwise it uses the bound port. The listener supplies HTTP or HTTPS, and IPv6 literals are bracketed. A loopback or zoned non-loopback bind without an advertised authority fails with `mob/no-advertised-origin`. The value carries no process token.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The `mob-quick-join` insert; it targets no existing row |
| [`src/index.ts`](src/index.ts) | The host half: mounts the `mob` Remote namespace and nothing else |
| [`src/join-url.ts`](src/join-url.ts) | The shared URL composer the Remote method calls |
| [`src/controller.ts`](src/controller.ts) | `MobJoinController`: the `mob` Remote namespace's `joinUrl`, classifying a deployment that declared no origin as `mob/no-advertised-origin` |
| [`src/types.ts`](src/types.ts) | The `mob` failure-code declarations (`mob/no-advertised-origin`), shared by both faces |
| [`src/pairing.ts`](src/pairing.ts) | The pairing sessions: eight-character codes with a two-minute life, one decision each, and per-source throttling that counts only reads naming no live code |
| [`src/routes.ts`](src/routes.ts) | The `/pair*` named routes: the phone's shell and cookie-less state read, and the operator-authenticated decisions |
| [`src/client/PairScreen.tsx`](src/client/PairScreen.tsx) | The phone's pairing screen: the boot fact, the state poll, and the copy per decision |
| [`src/client/`](src/client/index.ts) | The browser half: Connect-phone row, pairing panel, and the `settings.mobile` dictionaries |
| [`src/client/PairingPanel.tsx`](src/client/PairingPanel.tsx) | The computer's pairing panel: code and countdown, decisions, device list, and the recycle bin |
| [`src/client/pairing-api.ts`](src/client/pairing-api.ts) | The `/pair*` routes as the panel calls them, with the device-name and pairing-URL helpers |
| — | No runtime invariant companion is published; every observable effect is derived per call from the deployment's declared origin (see Invariant ownership below). |
| [`tests/mob.spec.ts`](tests/mob.spec.ts) | Host half: namespace registration, join answer, disposal |
| [`tests/web-profile-composition.spec.ts`](tests/web-profile-composition.spec.ts) | The real Loader-composed `web` profile: the declared origin and `mob/no-advertised-origin` |
| [`tests/join-url.spec.ts`](tests/join-url.spec.ts) | The URL composer and the `joinUrl` Remote method: the advertised URL, the trusted host, and the no-declaration path |
| [`tests/pairing.spec.ts`](tests/pairing.spec.ts) | Pairing sessions: codes, approval, expiry, single use, and throttling |
| [`tests/routes.host.spec.ts`](tests/routes.host.spec.ts) | The pairing routes: access rules, code flow, device cookie, and body edges |
| [`tests/pair.client.spec.tsx`](tests/pair.client.spec.tsx) | The pairing screen: polling, navigation on approval, and the copy per decision |
| [`tests/panel.client.spec.tsx`](tests/panel.client.spec.tsx) | The pairing panel: code and countdown, decisions, device list, and the recycle bin |
| [`tests/pairing-api.client.spec.ts`](tests/pairing-api.client.spec.ts) | The pairing routes' client half: request shapes, answer parsing, and helpers |
| [`tests/apply.client.spec.ts`](tests/apply.client.spec.ts) | Row registration, deferred slot declaration, injected `joinUrl`, disposal |
| [`tests/row.client.spec.tsx`](tests/row.client.spec.tsx) | The row and dialog: load, QR render, startup guidance, close and reopen |

### Invariant ownership

No invariant companion is published because the plugin's observable effect — the `mob.joinUrl` answer, derived from the deployment's declared origin on each call — leaves no cached state a second observer could diverge from, and the Remote artifact wiring is validated at build time by the Typert generator.

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

- **HTTP exposes credentials to the network** — use a trusted network or configure the listener’s TLS support; [dsh-web-app](../web-app/README.md) owns transport and authentication configuration.
- **LAN plain HTTP is not a secure context** — a phone browser gets no `navigator.serviceWorker` over plaintext LAN HTTP, so the service worker never registers and Android shows no install prompt; iOS reliably honors `apple-mobile-web-app-capable` for add-to-home-screen. Configure HTTPS for browser features requiring a secure context.
- **iOS home-screen apps get no background WebSocket** — iOS suspends the app while it is in the background, so returning to the foreground recovers the stream through the existing Connection generation reconnect and the Remote journal stream's resume cursor.
- **The address is configured, not discovered** — the join root uses `--public-url`, a trusted authority, or the concrete non-loopback bind. No adapter scan extends trust.
- **A wildcard bind is refused** — `dsh web` rejects `--host 0.0.0.0` and `--host ::`; name one interface address instead.
- **A deployment with no declared origin serves no join URL** — the Connect phone dialog fails with `mob/no-advertised-origin` and names the flags to add; the `dsh-web-app` readiness line stays the only printed URL.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
