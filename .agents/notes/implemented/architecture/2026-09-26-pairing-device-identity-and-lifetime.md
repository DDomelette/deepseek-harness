# Agent Note: Paired-device identity, rename, and one-day default lifetime

Status: implemented

English | [中文](2026-09-26-pairing-device-identity-and-lifetime.zh.md)

## Problem

The pairing panel registered every approved phone under the label derived from its `User-Agent`, with no way to rename it afterwards and no hardware fingerprint, so two identical phone models were indistinguishable. The per-device lifetime UI was a preset row plus a separate arbitrary-days box, and a newly paired device silently received a thirty-day credential window.

## Decision

- **MAC fingerprint via ARP.** The approval route reads the claiming phone's remote address from `PairingSessions.sourceOf` — recorded alongside the agent on the mandatory screen claim — and resolves it through the system ARP table (`arp -a` on Windows, `arp -n` elsewhere). The phone just talked to the Host, so its entry is fresh; a missing or stale entry, a non-IPv4 source, or a platform without `arp` stores no MAC rather than failing the approval. The resolved MAC is normalized to lowercase colon form and validated against that shape at the registry's durable-record boundary.
- **Rename.** `renameDevice` relabels an active or binned entry through the same read-modify-write as every other registry mutation, exposed as `POST /pair/devices/label` (non-empty, at most 64 characters, same loopback-and-session guard) and an inline rename input on the device row.
- **Credential lifetime dropdown.** The panel collapses presets and the arbitrary-days box into one *Credential lifetime* menu — 1/7/30/90-day presets with a pinned *Custom…* entry that unfolds the day-count row.
- **One-day default.** `deviceLifetimeDays` defaults to 1, so a pairing the operator never revisits expires the next day instead of a month later; the 1–365 range is unchanged.

## Alternatives considered

- **MAC as the device id.** Rejected: ARP resolution is best-effort (a routed or VPN path has no entry), so the MAC can only decorate the row; the random `PairedDeviceId` stays the identity.
- **Passive fingerprinting from headers or TLS.** Rejected: nothing on the LAN HTTP path exposes a stable hardware identifier, and inventing one would mislabel shared devices.

## Consequences

- A device row can show a `MAC` line only when the claim arrived over IPv4 on the local link; loopback test claims and cross-subnet phones show none.
- [Pairing requests require a claim](2026-09-26-pairing-requests-require-claim.md) remains the authority for when a code enters the decision list; this note owns what the registered row records, except the credential expiry [the renewal record](../bug-fix/2026-10-06-device-credential-truth-and-renewal.md) owns.
