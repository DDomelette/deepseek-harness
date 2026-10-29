# Agent Note: An approval names the device it registers

Status: implemented

English | [中文](2026-10-07-approved-labels-and-copy.zh.md)

## Problem

The approval route validated a pairing code and a decision but not the label it stored. `POST /pair/devices/label` refuses an empty or oversized name, so an approval could register a row the operator could no longer rename to anything legal — the same field, held to two different rules on one surface. The label was also stored untrimmed, so a name typed with stray spaces became part of the device's identity in the panel and in every later rename.

An ARP row that records `00:00:00:00:00:00` passed the filter that skips broadcast and multicast addresses and was stored as the phone's hardware fingerprint. The all-zero address is what a row carries when no hardware address is known; it identifies nothing.

Three `dialog.*` dictionary keys described a state no surface renders: the panel resolves a join-URL refusal into either the loopback copy or the generic failure notice, and it dispatches the code request without a loading state, so `loading`, `noLanAddress`, and `loadFailed` were dead copy in both languages. The package README counted eight `/pair*` routes where eleven are registered, and claimed the per-source throttle covers both phone routes when only `/pair/state` reads codes.

## Decision

The approval applies the same bound as the rename route — a non-empty label of at most 64 characters — and trims it once, so the decision, the registered row, and the logged warning all name the same string. A refused label answers 400 without deciding the session, which leaves the operator free to approve the same code with a valid name.

`macFromArpOutput` treats the all-zero address as unusable, alongside broadcast and multicast.

The three unreachable `dialog.*` keys are deleted from both dictionaries, and the README states the current route count and which route carries the throttle.

## Alternatives considered

**Keep the label bound only on rename.** Rejected: an approval that stores an unnameable row is a validation hole on the surface that creates the row.

**Reject the approval instead of the label.** Rejected: a typo in the name would then cost the operator the whole pairing, while the phone waits on a code that is still valid.

**Store the all-zero MAC and filter it in the panel.** Rejected: the registry is what other readers consult; an absent fingerprint belongs in the record, not in each view.

**Keep the dead keys for a future loading state.** Rejected: unreachable copy drifts silently, and the state it describes has no owner; a later loading state adds its own key.

## Consequences

A device row carries the name the operator typed, bounded the same way wherever it is set, and the panel offers no name it cannot later change. The registry stores no hardware fingerprint for a peer whose address is unknown, so a row shows no MAC instead of a meaningless one. Both dictionaries carry only reachable copy, and the README's route count and throttle description match the registered surface. The backlog items this note owns are marked fixed in the [pairing backlog](../../proposed/bug-fix/2026-10-06-phone-access-and-web-surface-defect-backlog.md).
