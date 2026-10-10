# Agent Note: Closing verified reliability gaps in output reads, deletion, client lifecycle, projection, and framing

Status: implemented

English | [中文](2026-10-11-verified-reliability-gaps.zh.md)

## Problem

An external audit reported eleven defects across the subprocess output path, session deletion, the SDK client and protocol, the workspace Client, session projection, LSP framing, and tool-result finalization. Each was re-verified in this tree; the two output-read findings were reproduced against the shipped code, and the framing and materialization findings were measured:

- `OutputCollector.spillAll` opened and wrote its spill file inside the stream `data` callback, so a filesystem failure there (a full disk, descriptor exhaustion, a removed spill directory) escaped as an uncaught exception and ended the host process before the spawned command's outcome was reported. Every other spill failure in that class was already contained.
- `readFrom` decoded whatever byte range the caller's offset landed on, so a multi-byte character split across two reads was replaced on both sides with no flag: `中` arriving as 1+2 bytes read back as one replacement character and then two more, with `lossy` false. `subprocess-e2b`'s reader had the same defect.
- Recursive deletion enumerated lineage and only reserved the plan members afterwards, so a subagent created while `sessionPersistence.list()` was pending was neither refused by the `session/created` guard nor part of the closure: the parent was deleted, the child survived, and the call reported success.
- A retry appended newly discovered members to the durable plan and executed that array order, so a descendant discovered on the retry was deleted after its own ancestor.
- `DeepSeekHarness.start()` cleared its memoized handshake before awaiting SDK-owned cleanup, so a caller arriving during that await began a handshake on the client `HarnessClient.close` was running down.
- `JsonRpcLineTransport` kept no terminal state and listened only to its input, so a request issued after the input ended waited for a response that could not come, and an asynchronous output failure reached no waiter.
- A workspace-file follower resolved its ready promise once, so a reconnected `changes` generation re-stat'ed nothing and a write made while the stream was gone was reported by no frame at all.
- `rename` and `insertSessionBefore` upserted their unary echo unconditionally after the await, so a response that resolved after a follow-generation increment for the same Workspace replaced it — the `updatedAt` comparison cannot separate projections carrying the same millisecond.
- The projection change loop called every listener unguarded, so one throwing subscriber skipped the subscribers after it and unwound the drive over the units this event had not reached.
- `MessageDecoder` concatenated every arriving chunk onto the accumulated buffer: one 1 MB frame in 4 KiB chunks copied 123 MB, and an 8 MB frame costs roughly 8 GB.
- `finishScheduledExecution` materialized the same already-materialized result again when no content finalizer was registered; a probe of one echo call counted three full detach-and-freeze passes.

## Decision

Each gap is closed where the contract it violates is stated, and every fix carries a test that fails without it.

**Subprocess output.** `OutputCollector` contains a spill failure the way it already contains a close, unlink, or over-cap failure: the unusable file is discarded, the advertised spill path is withheld, and collection keeps its in-memory tail. An incremental read ends at the last complete UTF-8 character and `nextOffset` points at the end of the text it returned, so the read that receives the remaining bytes returns the character whole. Both providers cut that boundary with `readCompleteUtf8`, exported from `dsh-subprocess` as a plain function beside `scrubbedParentEnv`, so the rule has one home and each provider's tests pin it.

**Session deletion.** The target is reserved before the first await, and each pass reserves what it found before enumerating again; the plan is fixed once a pass discovers nothing new. Reservations are released as one set, so a member another deletion owns is refused rather than released. Cleanup order is re-derived per attempt from that attempt's lineage, leaves-first, while the plan's member array keeps its order as the reported deletion set; a member no longer persisted is cleaned last.

**SDK lifecycle.** `start()` clears its memoized handshake only after cleanup and client replacement finish, so a caller arriving during cleanup awaits the same operation. The transport holds one terminal cause — from `close()`, an input end or error, or an output error, with the output listener attached by `start()` and removed by `close()` — which fails pending requests, rejects a later request instead of leaving it pending, and drops notifications.

**Workspace client.** A follower that is already acknowledged queues a resync notice for each later ready, which the provider answers with a fresh stat; a notice that is not bound to a Host path passes the follower's path filter. `rename` and `insertSessionBefore` apply their echo only while no stream frame arrived, which is how list, archive, and order responses in that model already resolve the same race.

**Session projection.** Each change listener runs in its own try/catch and a failure is logged with the unit key, as `docs/defensive-patterns.md` requires of a dispatcher.

**Framing and materialization.** `MessageDecoder` keeps pending bytes as the segments they arrived in, searches the separator segment by segment with the previous segment's last bytes, and joins only the frame it is reading. `finishScheduledExecution` reuses the candidate it already materialized when the content finalizer returned it unchanged.

## Alternatives considered

- **Let the caller handle a spill failure instead of containing it.** Rejected: the failure happens inside a stream callback, so "the caller" is the host process, and the collector's own close, unlink, and over-cap paths already degrade to the in-memory tail.
- **Hold back a partial character by re-reading from the spill file.** Rejected: the retained tail is already in memory, and a read that resumes at the boundary needs no file.
- **Keep each provider's own copy of the read boundary.** Rejected: the rule belongs to the reader contract in `dsh-subprocess`, and two copies of a byte-range scan drift; `pnpm run duplication` rejects the clone as well.
- **Refuse rather than contain a throwing projection listener.** Rejected: one subscriber's defect must not stop the units a committed event still has to reach, and the session append path that emits the event already contains observer failures.
- **Add a Host-side monotonic revision to Workspace projections.** Rejected for now: it changes the wire type and both sides; generation arbitration removes the same-millisecond loss on the paths that can race, and the stream's own `updatedAt` guard still rejects an out-of-order frame.
- **Make the framing decoder accumulate into one buffer sized from the header.** Rejected: the length is unknown until the header is complete, and the segmented form needs no pre-allocation guess.

## Consequences

- A spill that cannot be written now degrades silently to the in-memory tail instead of failing loud; `lossy`/`truncated` still describe the retained window, and the withheld spill path is the caller's signal that no full-stream recovery file exists.
- A read may now return empty text with an unchanged `nextOffset` while a multi-byte character is still arriving; consumers assign `nextOffset` directly, so the next read resumes correctly.
- Subagent creation is refused for the whole reservation window, including the enumeration await it previously raced. A creation that started before the reservation and commits after the last pass can still escape — the guard is an in-process event listener and cannot cover another process.
- Deleting a workspace registration for a member no longer persisted now happens after the live lineage; `deletion.spec.ts` records the new order, and the reported `deletedSessionIds` is unchanged.
- A caller of `start()` that arrives during a failed handshake's cleanup now shares that failure instead of starting its own attempt; the retry is the next call, on the fresh client.
- A request issued after transport termination rejects with the terminal cause rather than waiting; consumers that install their own `output` error handling still receive the event, and `notify` after termination is dropped.
- Reconnecting a `changes` generation costs one `stat` per open file, and a resize between generations is now observed even when no frame reports it.
- `materializeFinalResult` runs twice per tool call instead of three times; the pre-post-execute candidate snapshot and the commit outcome remain distinct passes.
- Agent Notes for the audited subsystems were not created separately: this batch shares one cause (an audit of the shipped tree) and one verification method (a failing test per gap).
