# Agent Note: Paired devices revoke into a recycle bin

Status: implemented

English | [中文](2026-09-26-paired-device-recycle-bin.zh.md)

## Problem

Revoking a paired phone was a hard delete: one click on the pairing panel dropped the credential row for good, so a misclick against a phone that is still in use forced a full re-pairing on the spot. The same panel had grown into a flat stack of gray pills — the lifetime presets, the custom-days box, and the *Revoke* button wrapped unpredictably — and the two guidance paragraphs above the device list took more vertical space than the devices themselves.

## Decision

Revocation is soft. `PairedDevice` gains an optional `revokedAt`; `revokeDevice` stamps it instead of deleting the row, `restoreDevice` clears it, and the new `purgeDevice` is bin-only by design — an active device must pass through the bin before it can be deleted, so deletion anywhere in the product always goes through the recycle bin. A binned entry keeps its id and window but fails authentication (`BrowserAuth.accepts` rejects it), and a restore re-admits the same cookie while its window is still open, which makes the bin a real undo rather than a delayed delete.

The pairing routes expose the shape directly: `POST /pair/revoke` bins, `POST /pair/devices/restore` restores, and `POST /pair/devices/purge` deletes a binned device, all behind the same loopback-plus-launch-cookie guard as before. The bind-failure rollback inside the approve route bins and then purges the orphaned row, because deletion is bin-only.

The panel is rebuilt around the same structure: the open code is a card with the QR, the code, a countdown bar, and a copyable link; waiting requests and paired devices are cards instead of pill rows; and a recycle-bin section appears once anything is binned, offering *Restore* and a two-step *Delete permanently*.

## Alternatives considered

- **A confirm dialog on the old hard delete.** Rejected: a confirm prevents misclicks but offers no undo after the fact, and the operator who revokes the phone currently in their hand — the case the guidance copy warns about — still loses it for good.
- **Client-side undo window.** Rejected: delaying the real revocation weakens the security guarantee the revoke hint promises (a stolen-cookie device must die on its next request), and a timer-based commit is invisible to a second operator surface.
- **Bumping the credential record version.** Not needed: `revokedAt` is optional, the parser accepts entries without it, and older builds ignore fields they do not read, so committed records need no migration.

## Consequences

- `GET /pair/devices` now answers binned rows too (with `revokedAt`); the panel splits the list into the paired section and the recycle bin, so any other consumer of that route must filter on `revokedAt` if it wants active devices only.
- The recycled entry still counts against nothing and authenticates nothing; its only effect is the row the operator sees and the restore it enables.
- [Phone access in the web profile](2026-09-12-phone-access-in-the-web-profile.md) remains the authority for the handshake; this note owns the device row's lifecycle after approval.
