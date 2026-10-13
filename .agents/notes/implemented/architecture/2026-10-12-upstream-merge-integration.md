# Agent Note: Upstream 0.2.1-alpha.2 merge integration decisions

Status: implemented

English | [中文](2026-10-12-upstream-merge-integration.zh.md)

## Problem

The fork merged upstream 0.2.1-alpha.2 (`upstream/master` `d743267388`) into a tree that had diverged across the session family, the shells, the subagent plane, the settings plane, and the job mirror. Upstream had replaced several seams the fork's features were built on — the jobs notification API, the settings provider seam, `SubagentRuntime`'s continuation entry points, the message-source vocabulary, the session log format — and had also shipped surfaces this fork has no consumer for. Each seam needed a decision: port the fork's behaviour onto the new API, take upstream's replacement and delete the fork's, or shelve the upstream surface. Adopting upstream's `SESSION_FORMAT_VERSION = 4` while the JSONL scanner still admitted current-generation rows with the V3 rule left every session log containing a system message unreadable, which surfaced first as nine cold-resume failures in the Agent Team package.

## Decision

Port the fork's behaviour onto the merged APIs, keep fork-only implementation inside packages where the fork's code is the surviving implementation, and shelve upstream surfaces that nothing in this tree mounts. The sections below record the four ports that shaped shipped behaviour, the settings and session-format moves, and what was deliberately not taken.

## Job changes ride the merged jobs event stream

The fork's `SessionControlController` mirrored background jobs per session and `ui-jobs` rendered its header over that mirror, so deleting the wiring the way upstream does would have removed a live feature. The merged jobs service replaced `onJobsChanged(owner)` with a filtered event stream, so `packages/api/session-controller/src/control.ts` subscribes with `events.subscribe({ owners: 'all' }, …)`, ignores the `output` and `progress` events that move no published row, and republishes on the lifecycle commits that map onto the old notification sites. Job lookups pass a `SessionId` (`jobs.list(caller)`), not an `Agent`, matching the merged registry: an unowned job is visible to every caller, and a job with an owner is visible to that session.

## The subprocess control channel is an additive port

The fork's reliability work needed a byte channel beside stdio. `packages/subprocess/subprocess/src/control.ts` owns the protocol: descriptor `SUBPROCESS_CONTROL_FD` 7, the private launch marker `DSH_SUBPROCESS_CONTROL`, and `openInheritedControlChannel()`, which consumes the marker and returns a byte-mode duplex socket over the inherited descriptor. `SubprocessStdio` gains the optional `control?: 'pipe'` request and `SubprocessHandle` gains the optional `control` duplex, so a launcher that does not ask for the channel is unaffected. The Windows launch path carries the same channel through `packages/subprocess/win32-process/src/control-stdio.ts` and `sandbox-windows-acl` forwards an existing fd 7 into the restricted child, refusing control with piped stdio.

## Session deletion forgets through the workspace registry

`packages/workspace/workspace` exposes `registry.forgetSession(sessionId)`, so `session-deletion` calls it for the workspace leg of a deletion plan and advances that member to `done`. The consumer carries no compensation for an absent registry method: a missing `workspaceRegistry` marks the member `skipped` and the durable plan records that outcome.

## Subagent working-directory injection

The merged `SubagentRuntime` resolves every child's directory through `ctx.workingDirectory.ensure(parent, signal)`, so the service is part of its injection set. A composition that mounts the subagent runtime without `dsh-working-directory` leaves every start and every cold resume pending rather than failing loudly: the base bundle mounts it, and tests mount the shared `mountWorkingDirectoryFixture`.

## Settings namespaces come from the composition

Upstream replaced the settings provider seam: `SettingsForms` derives one namespace per active Loader entry from that entry's exported `Config` schema, so a plugin declares its section instead of calling `ctx.settings.register()`. The fork's consumers were migrated rather than the seam restored — `settings-controller` imports `SettingsForms`, fills `autoGenerate` from the presentation map, and declares `agent-preset/read-only` in `RemoteErrorDetailsMap`; `mcp-manager` declares a volatile `Config` dict and moves its declarative cross-check into an internal `config` waterfall listener gated to an active fiber, keeping the fork's write refusal and stored-section backstop.

## Session format v4 admission

The merge adopted `SESSION_FORMAT_VERSION = 4` and imported `packages/session/session-format-v3-to-v4`, but the fork's `packages/session/session-persistence-jsonl/src/format.ts` — which the merge kept whole — still admitted current-generation rows with `assertV3RowAdmission` and never ran `assertReleasedV4Relationships`. V3 admission requires a `system/message` source of `kind: 'plugin'`, while the merged `createSystemMessage` writes `kind: 'system-prompt'`, so the scanner refused every log the loop writes and every read-back path failed. The port re-applies upstream's three lines onto the fork's scanner: `KNOWN_SESSION_EVENT_TYPES` in the import block, `assertV4RowAdmission(decoded, KNOWN_SESSION_EVENT_TYPES)` in `consumeEventLine`, and `assertReleasedV4Relationships(artifact, KNOWN_SESSION_EVENT_TYPES)` in `finish()`, plus the dependency, project reference, and aggregate reference that name `dsh-session-format-v3-to-v4`.

## Deliberate shelvings

**The Office line.** Upstream's Office client packages are not imported and no bundle mounts them; this fork ships its own plugin inventory page.

**Three unmounted upstream client packages.** `client-ui-cot-translation`, `client-ui-voice-input`, and `ui-plugin-manager` are shelved like the Office line: no bundle mounts them, and their slot seats exist only in upstream's client packages, so declaring the slots locally would leave dead registrations.

**Upstream's `tool-schedule`.** The fork keeps its own schedule plugin and ported upstream's two expectation specs onto the fork's `after`/`at`/`every` model instead of taking upstream's `ScheduleService`.

**The preset directory-opening surface.** The merged `AgentPreset` carries no trust and no path, because upstream replaced the fork's directory-discovering agent-presets package with a registry that declares presets inside `cordis.yml`; opening a user-authored preset directory therefore has no data source. The surface was removed end to end — both preset-opening Remote methods, the SettingsController `nativeOpen` field, `canOpenPath`, `AgentPresetDirectoryOpenValue`, the `agent-preset/read-only` error code, the connection fixture dispatch entries, the `ui-agent-preset` location affordance with its locales and CSS, and the cases that only covered it. Restore `agent-preset/read-only` if a Host-side `deletePreset` returns.

## Alternatives considered

- **Keep the fork's own settings provider seam.** Rejected: upstream derives namespaces from the Loader composition, which is also what makes a plugin's section appear without a registration call; keeping both would leave two authorities for one section.
- **Keep the V3-era session-format versions.** Rejected: the merged session family, session-format catalog, migrations, and web profile are v4 throughout, so pinning the JSONL backend at v3 would have required reverting `createSystemMessage`, the message-source vocabulary, and the imported edge.
- **Adapt upstream's tests to the fork's `win32-process` API instead of porting the missing accessor.** Rejected: `sandbox-windows-acl`'s failure-path spec is upstream's and exercises the same native layout the fork's eager bindings already materialize; a one-line accessor keeps both sides compiling without rewriting a spec.
- **Delete the job mirror instead of wiring it.** Rejected: `ui-jobs` renders over the mirror and the Web profile mounts it, so the deletion upstream performs would have removed a shipped header.

## Consequences

- The Agent Team package is green: `team.spec.ts` 48/48 and `persistence.spec.ts` 5/5, from 9 failed | 44 passed before the admission port.
- `packages/sdk/server` keeps one failing assertion: it expects `body.reasoning_effort === 'max'` while the merged DeepSeek adapter speaks the Messages wire format. That assertion belongs to `packages/llm/llm-deepseek` and was left red pending that decision.
- `packages/subprocess/subprocess-local/tests/control.spec.ts` keeps two of six cases red on Windows, both timeouts on `handle.done` and `once(channel, 'data')`; the four that pass include the 256 KB binary transport, and the wiring stays.
- The fork's V3-era `session-persistence-jsonl` specs still describe the pre-merge migration path: the merged JSONL backend has no working historical-generation migration (upstream's catalog-migration consumer was not taken with its edge), so v0/v2/v3 fixtures are refused with different messages than those specs assert. That workstream is separate from the admission port and remains open.
- `packages/session/session-persistence-jsonl/package.json` now declares `@deepseek-ai/dsh-session-format-v3-to-v4`; a `pnpm install` is required to materialize that workspace link.
