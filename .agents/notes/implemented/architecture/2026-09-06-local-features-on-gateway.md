# Agent Note: Local Web features on the Gateway controllers

Status: implemented

English | [中文](2026-09-06-local-features-on-gateway.zh.md)

## Problem

The local Web features depend on API and persistence components that the Gateway runtime replaces. Keeping both implementations would give session lifecycle and settings writes competing owners.

## Decision

Local pins, archive details, MCP management, skill switches, plugin groups and usage recording use the Gateway Remote namespaces, API Session and Workspace controllers, and client store. Their feature notes retain the product rationale; this note owns their integration with the current runtime.

The API keeps exact Agent handles it creates or resumes. Permanent deletion checks every cascade member before closing idle owned handles, then uses a durable leaves-first cleanup plan. Running or foreign-owned Agents refuse deletion. JSONL deletion and historical read migration acquire the same kernel write lease; deletion removes all generations and attachments while retaining the lock inode. Ordinary migration still preserves historical bytes. Windows loads its Koffi lock backend without loading POSIX fs-ext.

Settings mutation results report Host acceptance independently of the client mirror. Secret edits name only changed paths. Plugin group keys distinguish global rows from each preset's rows; grouping changes browser presentation and never changes Host enablement. Archive timestamps travel with archive membership, while streamed state takes precedence over older unary echoes. Local usage recording is enabled in the base composition; HTTP export is disabled unless explicitly configured and enabled.

## Alternatives considered

Restoring the removed API proxy and client runtime would create two competing state owners. Restoring SQLite Session persistence would bypass the current JSONL generation and ownership guarantees. SQLite query indexes remain separate from authoritative Session storage. Assuming an optimistic mirror proves a successful save would hide Host refusals.

## Consequences

The integration retains the local features while using the current Gateway lifecycle and storage format. Existing user data is not rewritten by the merge itself. Package tests cover refusal and lease ownership, state ordering and configuration writes; real Web compositions cover MCP saves, skill toggles, archive restoration and recursive deletion. Platform-sensitive filesystem behavior is exercised in both Windows and Linux.
