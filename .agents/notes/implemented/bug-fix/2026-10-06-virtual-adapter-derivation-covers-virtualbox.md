# Agent Note: LAN derivation recognizes VirtualBox host-only adapters

Status: implemented

English | [中文](2026-10-06-virtual-adapter-derivation-covers-virtualbox.zh.md)

## Problem

`resolveLanTrust` sorts physical adapters ahead of virtual and tunnel ones by matching the interface name, and its JSDoc named "VMware/VirtualBox host-only nets" among the families it covers. The pattern carried no VirtualBox term, so a `VirtualBox Host-Only Network` adapter on Windows, or `vboxnet0` on Linux and macOS, counted as physical and competed for `lanAddresses[0]` — the address the readiness line prints first and the only input the Connect-phone QR is built from. A host-only adapter is reachable from this machine and never from a phone, so the pairing link pointed at an address the phone cannot open, and the QR has no candidate fallback (only the readiness line lists the rest). The Docker Desktop bridge `bridge100` on macOS was missed the same way, since the `^br-` term anchors the Linux name only.

## Decision

The pattern gains `virtualbox`, `vbox` (which also covers `vboxnet0`), and `^bridge\d` for the macOS Docker Desktop bridge, and the JSDoc now names those forms.

## Alternatives considered

- **Sort by address class.** Rejected: host-only ranges overlap real LAN ranges (`192.168.56.0/24` against `192.168.1.0/24`), so no address rule separates them.
- **Ask the operating system for the adapter type.** Rejected: `os.networkInterfaces()` reports no such fact, and platform-specific enumeration replaces one name heuristic with several.
- **Prefer the adapter that owns the default route.** Rejected: Node exposes no route table, and shelling out to `route print` or `ip route` adds a platform-dependent failure mode to startup for the same heuristic.

## Consequences

- A machine with a VirtualBox host-only adapter and a physical adapter lists the physical address first, so both the readiness line and the pairing QR name an address a phone can reach.
- The heuristic stays a name list; another vendor's host-only adapter needs its own term, which the JSDoc records as the contract.
- The remaining candidates are still printed and still fenced, so an address this list misranks stays reachable by copying the next one.

## Testing

`packages/bundle/web-app/tests/web-app.spec.ts` asserts the derived order for an interface table holding `VirtualBox Host-Only Network`, `bridge100`, and a physical `en0`, and then for `vboxnet0` beside `en0`. Without the terms the first assertion reported `192.168.56.1` ahead of `192.168.1.5`.
