# Agent Note: Upstream 0.2.2 integration with fork-owned features

Status: implemented

English | [中文](2026-11-08-upstream-022-fork-integration.zh.md)

## Problem

The fork has phone pairing, ordered pins, notes, skill settings, recursive Session deletion, and E2B providers that consume APIs replaced in upstream 0.2.2. Its earlier upstream integration copied a release tree without recording upstream as a merge parent, so Git ancestry alone does not identify the content baseline. A repeated snapshot import would compound that ambiguity and leave shared API consumers on incompatible generations.

## Decision

The integration uses the content baseline identified by the [0.2.1 integration](2026-10-12-upstream-merge-integration.md) for three-way reconciliation and records the upstream release as a merge parent. Upstream owns the current package locations, application assemblies, tool execution interfaces, Remote services, and build tooling. Fork-owned features consume those APIs; duplicate package locations and the superseded MCP supervisor are absent.

Browser launch cookies retain version 1 and paired-device cookies retain version 2. API connection cookies use version 3, since upstream's version 2 would collide with persisted device credentials. Each paired device owns its Peer lifetime, so revocation ends its connections without disposing the browser operator. Device management additionally requires a loopback caller. The HTTP resource adapter supplies the socket address to browser authentication so a Fetch Request retains the loopback evidence. Unauthenticated trusted LAN requests receive the pairing shell with HTTP 401; an index alias on a case-insensitive filesystem receives the same authentication treatment as the configured index.

The MCP settings panel reads a small `mcpServers` projection of the current Manager and declarative Loader entries. Credentials do not appear in that projection. The panel writes the `mcp-manager` entry, and legacy settings import maps `mcp-servers` to that entry. Declarative and configured names cannot collide. The Manager owns connection lifecycle; its status notifications isolate failing observers. No Manager invariant companion repeats its own configuration validation. Team state likewise has one committed projection rather than an invariant companion replaying the same fold.

Notes, pins, deletion, and skill catalog endpoints are explicitly owner-only in the share-viewer endpoint classification. Workspace follow responses filter fork-owned archive timestamps and flags to the visible Session set. The Remote assembly and both Notes compiler faces reference a single declaration-only project for Notes types. Projection observers cannot stop other observers by throwing. E2B implements the current guarded patch, deletion, and move operations using the shared patch library and ordered target locks; a move that publishes its destination but cannot remove its source reports that partial result.

The fork retains its mobile floating entry and edge-swipe drawer, while folded landscape posture participates in the current column calculation. The upstream browser corpus and its goldens encode the upstream client surface, so fork CI keeps that corpus out of the required lane until the fork's handset drawer and plugin panels are reconciled with it. UI tests distinguish local interaction state from Host-owned pin order: a pin drop writes the pin domain and leaves manual Session order intact.

Committed Session generations and sealed Agent Note triplets retain their existing bytes. New upstream artifacts are additional files. Runtime deletion concerns user-owned Session storage, not committed fixture history.

Fork workflows select public GitHub-hosted runners. Automatic real-API E2E runs require `DSH_RUN_REAL_API_E2E=true`; explicit manual runs still require credentials and fail their preflight when credentials are absent. Upstream keeps automatic E2E and its runner routing. Fork jobs cannot resolve the Ubuntu archive, so the pinned bubblewrap package falls back to a hash-matched Kernel.org mirror and apt's mirror list and sources point at that same mirror before installing system packages. Repository ownership checks use the canonical upstream identity returned by GitHub, while external action repository names retain their own identities.

The concrete-term check excludes committed Session JSONL names because logged text is immutable even when prose policy changes. Repository-reference checks retain recorded vendor origins only in generated notice table rows; the notice generator verifies those bytes against the vendoring manifest. The unknown-cast baseline includes existing fork assertions identified in the pre-merge tree, while new assertions must narrow or use a typed fixture. Upstream source-only package exports remain available to workspace builds. Webhook ingress remains a maintained optional fork integration under `packages/webhook`, consumed by the GitHub review example.

## Alternatives considered

**Replace the fork with the upstream tree.** This removes supported pairing, notes, pins, and provider behavior, so the integration ports their consumers instead.

**Retain the old MCP runtime beside the Manager.** Two owners would reconcile the same configured servers and disagree about lifecycle and settings. The panel projects the Manager instead.

**Reuse upstream's API cookie version.** Version 2 already identifies the fork's device cookies; separating the payload versions preserves existing devices and prevents cross-class authentication.

**Import another single-parent snapshot.** That repeats the missing-ancestry problem and makes future reconciliation depend on reconstructing another content baseline.

## Consequences

Future upstream merges have recorded ancestry. The fork still owns integration work for its additional APIs and UI behavior. Shared tests follow current interfaces, and fork regressions cover authentication, device lifetime, projection observers, E2B operations, pin ordering, and settings projections. Source-mode invariant imports resolve to their source companions; built consumers continue to use published exports. Windows tests that require creating file symlinks need a host with that permission.
