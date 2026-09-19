# Agent Note: Preserve plugin ownership when consolidating repeated operations

Status: implemented

English | [中文](2026-09-20-owner-local-workspace-and-settings-reuse.zh.md)

## Problem

MCP server forms repeat the same connection fields, while Workspace archive operations repeat their response and storage updates. Those copies maintain the same behavior within one package. Similar-looking code across plugins has a different cost: sharing it can couple independently evolving interactions or persisted formats.

## Decision

The MCP add and edit forms share package-internal connection fields and retain separate validation, secret handling, and persistence. Workspace commands share archive error mapping and response projection within the controller. The registry shares archive-membership removal within each caller's existing serialized operation; no nested queue or new service API is introduced. Archive ids and timestamps retain the semantics recorded in [archive details and times](../feature/2026-08-21-archived-details-and-archive-times.md).

Pinned and Workspace rows use the existing relative-time formatter and a shared `StatusDots` presentation primitive. The primitive accepts already ordered, localized statuses, renders their first visual marker, and exposes every label to screen readers. Status derivation, navigation, drag behavior, and commands remain with each plugin. Both plugins already depend on [UI primitives](../../../../packages/client/ui-primitives/README.md), so sharing this rendering adds no plugin-to-plugin dependency. This follows the [shared-controls decision](../architecture/2026-09-05-shared-client-control-primitives.md).

Three similar fragments retain narrow duplication-check exceptions: pinned and Workspace row interaction markup, settings failure/retry markup, and the frozen usage-telemetry token fields. Row owners have distinct reveal and drag behavior; settings owners control distinct failure visibility and retry lifecycles. Telemetry rows and token-meter projection state are independently versioned persisted data. Sharing their validators would give one format changes it did not authorize.

## Alternatives considered

**Extract every reported match into a shared package.** A session-row shell or retry wrapper would add a public component API to share a small amount of markup while leaving the meaningful behavior at each caller. A cross-package token schema would couple persisted formats merely because their numeric constraints currently match. Keeping these copies preserves ownership without adding a dependency.

**Keep every copy to avoid coupling.** Package-internal form and archive reuse introduces no package relationship. The status presentation already fits the static, Cordis-free UI layer and centralizes its accessibility behavior; leaving those copies provides no ownership benefit.

## Consequences

No plugin imports another plugin's implementation. Public commands, persisted fields, localized labels, and visible interactions remain unchanged. Existing form and row tests cover their consumers, while focused archive tests verify error propagation, retained timestamps, and idempotent writes. Row tests exercise the shared status component's accessible labels. Duplication exceptions remain limited to the independent fragments rather than excluding their files or packages.
