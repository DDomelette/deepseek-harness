# Agent Note: Connect-phone settings page and the saved bind policy

Status: implemented

English | [中文](2026-11-08-connect-phone-page-and-bind-policy.zh.md)

## Problem

The phone-join surface was a single row inside Settings → General: it opened a dialog that could only report `mob/no-advertised-origin` when the deployment bound loopback, and the only correction was relaunching with `--host`. Once an operator had picked a LAN address there was nowhere to keep it, and the row had no room to show or edit the address the next launch would bind.

## Decision

The bundle now registers a `settings.section` (id `mobile`, order 12, label 连接手机) instead of the General row. The page holds the existing pairing panel and, above it, an address block that edits `dsh-web-app`'s `web-startup` Config through an operator-gated `/pair/bind` route: `bindMode` is `loopback`, `auto`, or `fixed`, and `bindHost` is the fixed address. The route is the policy's write path: the Remote assembly reserves the settings RPC's own writes for the operator too, and this page keeps its operator-scoped endpoint so the policy can be read and saved before any settings form mounts.

`web-startup` resolves the fallback bind address when the invocation names no `--host`: `loopback` keeps `127.0.0.1`, `fixed` binds the trimmed `bindHost` (a blank address fails the launch rather than silently falling back), and `auto` takes the address of the interface the operating system routes through — probed with a UDP `connect`, which sends no packet — falling back to the saved `bindHost`, then the first non-internal IPv4, then loopback. The resolved value rides `webStartup.bind`, and the webserver row binds `ctx.webStartup.host ?? ctx.webStartup.bind.host`; `--host` keeps precedence for the invocation that names it.

A saved change applies on the next launch, because the listener binds before any page loads. A paired phone therefore sees the address facts and the operator-only reason, never the controls, while the operator keeps them on whichever page they opened — the LAN one included.

## Alternatives considered

- **Bind the LAN address by default.** The requested first shape, and the reason the page exists. Rejected by the operator's choice: a fresh `dsh web` would expose the GUI to every network the machine joins without an explicit decision.
- **Persist the address in a dedicated file.** Rejected: the settings/config pipeline already stores each entry's user layer in the profile patch and provides the revision-fenced, operator-authenticated write path; a second durable file would duplicate it.
- **Pick the LAN address by scanning interface names.** Rejected: virtual adapters (VMware, VirtualBox, Docker) are enumerated beside the real one, and name matching is the failure mode the earlier virtual-adapter work had to repair. The routing table names the interface traffic actually uses.
- **Keep the row and add a second dialog for the address.** Rejected: the page has to show the pairing controls and the address together — a deployment without a reachable origin has no pairing link at all — and a section is where the settings shell already puts a page with its own settings.

## Consequences

- Settings → Connect phone is the join surface: the address block states the page's own host, whether a phone can reach the deployment, the saved mode, and the restart requirement; the pairing panel below it is unchanged.
- `--host` still overrides for one invocation; the saved policy governs the launches that name none, and `loopback` remains the shipped default.
- Auto mode binds what the default route uses. A machine whose route changes between launches may bind a different address; the page reports the actual result after the restart.
- The operator edits the policy from whichever page they opened, the LAN address included; `--host` still overrides it for a single launch, and a paired phone can neither read nor change it.`n- A different bound address or port pairs every phone again: the device cookie is named and signed for its authority, so the page warns that the change invalidates existing pairings.
- The phone's own view of the page holds no address block, because its settings mirror is process-local.

## Testing

`packages/bundle/web-app/tests/startup.spec.ts` covers the flag publication, the fixed policy through a real Loader tree, the resolver's four outcomes, and interface detection with scripted `node:dgram` and `node:os`; `packages/bundle/mob/tests/apply.client.spec.ts` covers the section registration, the injected write path, and disposal; `packages/bundle/mob/tests/section.client.spec.tsx` covers the address block, the saved/failed notices, the read-only deployment, and the pairing panel; `apps/web/tests/phone-pairing.e2e.ts` replays both goldens over the real Web server.

## Related

- [Bind one concrete Web address](../architecture/2026-09-19-concrete-web-bind-address.md) — the concrete-address rule and the loopback default this policy falls back to.
- [Phone access in the web profile](../architecture/2026-09-12-phone-access-in-the-web-profile.md) — the layer's registration and pairing ownership.
- [LAN Web serving](../architecture/2026-09-11-lan-web-serving.md) — the fence, the warning, and the launch-token exchange around the listener.
