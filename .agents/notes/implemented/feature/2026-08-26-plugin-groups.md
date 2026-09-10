# Agent Note: Browser-local plugin groups in the inventory tab

Status: implemented

English | [中文](2026-08-26-plugin-groups.zh.md)

## Problem

The Plugin list tab rendered one flat catalog of every Loader entry — over 160 rows in a full deployment. Users could not organize the inventory into named collections; text search was the only navigation.

## Decision

**A browser-local groups store filters the inventory while retaining its global and preset sections.**

- Store: `createPluginGroupsStore()` in `packages/client/ui-settings-plugin-inventory/src/client/groups-store.ts` — a `defineStore` handle persisted to localStorage under `dsh.plugin.groups.v1`, passed as the slot entry's `store` option so the framework owns per-entry identity and rehydration. State is `{ groups: { id, name, entryIds }[], selection }`; `ALL_GROUP = 'all'` is the reserved selection showing the whole inventory. Membership stores global Loader entry ids or preset-scoped entry keys; the caller mints group ids (`randomUUID()` from `dsh-util-crypto` in the component) so actions stay deterministic.
- UI: a group selector, new-group dialog, membership editor and delete-group action operate independently of Host configuration. Membership edits persist immediately; Done closes the editor. Global members accept legacy bare entry ids; new keys distinguish global rows from each preset's entry id and module. Each card places its title and status on the first row and its entry identity on the second. Enablement and conditional-status tags remain visible. Overflowing titles scroll horizontally while respecting reduced motion.
- Deleting a group never deletes its members: they reappear under 全部, since grouping is a display overlay. Member ids whose entries are no longer deployed are filtered by presence at render, so a group shrinks silently rather than erroring.

## Alternatives considered

**Host-persisted groups (settings.yaml or the workspace domain).** Rejected with the user: grouping is a personal display preference, and browser-local persistence matches that demand without wire, schema, or settings-document churn.

**Read-only grouping without delete/remove affordances.** Rejected with the user; both delete-group and remove-member ship.

**Computed facets (by source or enablement) instead of user groups.** Rejected: named user collections were the stated need; computed facets remain possible later as additional pseudo-groups.

## Consequences

The inventory is organizable without changing the deployment or model inputs. Groups are local to the browser origin. Store tests cover persistence and mutations; component tests cover scope-qualified membership, legacy global ids and preset filtering.
