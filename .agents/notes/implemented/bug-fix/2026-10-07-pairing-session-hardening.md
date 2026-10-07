# Agent Note: Pairing sessions survive their own traffic

Status: implemented

English | [中文](2026-10-07-pairing-session-hardening.zh.md)

## Problem

Four defects on the pairing surface shared one shape: state that only grew, or a decision that could not be revisited after the one step able to fail.

`/pair/state` counted every read against the source's budget. The pairing screen polls every 1.5 seconds, so one page sat just under the ten-reads-per-ten-seconds limit while two pages open on one phone crossed it: the source locked for a minute in the middle of the pairing it was watching, and the screen's copy told the operator to mint a new code — advice that cannot work, because the lock is per source rather than per code.

The per-source attempt table had no deletion path, so every peer that ever read a code kept an entry for the life of the process.

An approval whose device registration threw left its session decided (`allow`) and unbound. The phone polled a decision it could never collect until the code expired, and the operator's retry was refused as already settled.

The panel reported a refused second click as a failure and never cleared a failure notice on a later success, so clicking *Allow* twice showed "operation failed" for a pairing that had actually succeeded.

## Decision

[`PairingSessions.stateOf`](../../../../packages/bundle/mob/src/pairing.ts) accounts only for reads that name no live code. A live session's read is the flow its screen is already in, so it spends neither the attempt budget nor a failure; the code-space search the throttle defends still locks, because five consecutive misses lock the source, and the per-window attempt budget still stops a source that alternates a live read with guesses to clear its own failure count. A source the budget locked can still collect the decision for the code it holds: the lock protects the code space, not a session already in flight.

`sweep()` — already called when a code is minted and when the panel lists requests — drops throttle records whose window rolled over and whose lockout has ended, because such a record is only ever rebuilt as a fresh one; a running lockout keeps its record until it lifts.

`PairingSessions.reopen(code)` withdraws an allowed decision whose registration failed, and `POST /pair/approve` answers 500 with `registration-failed`, logging the cause, instead of leaving the session decided. The operator decides again on the same code and the phone keeps polling `pending`; a denied, expired, or already-bound session is untouched.

The panel runs one decision or device action at a time: a click arriving while one is in flight is dropped, so a double click sends one request instead of a refused second one, and a successful action clears the failure notice. The throttled copy now asks for a minute's wait, which is what the lockout requires.

## Alternatives considered

**Raise the attempt budget so two pages fit.** Rejected: the budget is what keeps the code space unsearchable, and any larger literal only moves the collision to three pages.

**Lock per code instead of per source.** Rejected: the search being defended is over codes, so a per-code budget would stop defending the space an attacker actually probes.

**Keep the "create a new code" copy.** Rejected: the lock applies to the source, so that instruction sends the operator to an action that cannot work until the lockout ends.

**Retry the registration inside the route.** Rejected: the failing step is a credential write whose causes (a closed store, a record this build cannot interpret) are not transient by contract, so a retry loop would hide a fault instead of reporting it.

## Consequences

A phone can hold two pairing pages open without locking itself out, and a locked source still finishes the handshake it started. The attempt budget's flood arm — previously exercised by polling a live code — now needs a source that alternates a live read with guesses, which is the shape it actually defends; that case is pinned in [`pairing.spec.ts`](../../../../packages/bundle/mob/tests/pairing.spec.ts). The throttle table is bounded by the sweeps the pairing flow already performs. A failed registration is visible to the operator, who can retry on the same code, and the panel's mutations are serialized, so its failure notices describe real failures. The four Tier 2 items this note owns stay listed in the [pairing backlog](../../proposed/bug-fix/2026-10-06-phone-access-and-web-surface-defect-backlog.md) as fixed.
