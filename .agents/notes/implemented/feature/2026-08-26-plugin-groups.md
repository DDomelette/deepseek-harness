# Agent Note: Browser-local plugin groups in the inventory tab

Status: implemented

English | [中文](2026-08-26-plugin-groups.zh.md)

## Problem

The Plugin list tab rendered one flat catalog of every Loader entry — over 160 rows in a full deployment. Users could not organize the inventory into named collections; text search was the only navigation.

## Decision

**A browser-local groups store turns the tab into a two-column view: user-defined groups on the left, the selected group's plugins on the right.**

- Store: `createPluginGroupsStore()` in `packages/client/ui-settings-plugin-inventory/src/client/groups-store.ts` — a `defineStore` handle persisted to localStorage under `dsh.plugin.groups.v1`, passed as the slot entry's `store` option so the framework owns per-entry identity and rehydration. State is `{ groups: { id, name, entryIds }[], selection }`; `ALL_GROUP = 'all'` is the reserved selection showing the whole inventory. Membership stores stable Loader entry ids; the caller mints group ids (`crypto.randomUUID()` in the component) so actions stay deterministic.
- UI: the left pane lists 全部 plus user groups with live membership counts; a `+` button opens the name dialog (empty or duplicate names disable Save), and a hover button deletes a custom group. Selecting a group filters the right pane to its members and reveals 添加插件, whose picker lists non-members with checkboxes, a search field, a running 已选择 N 个 count, and Cancel/Add. Member cards carry a 移出分组 button; both panes narrow to a stacked layout under 680px.
- Deleting a group never deletes its members: they reappear under 全部, since grouping is a display overlay. Member ids whose entries are no longer deployed are filtered by presence at render, so a group shrinks silently rather than erroring.

## Alternatives considered

**Host-persisted groups (settings.yaml or the workspace domain).** Rejected with the user: grouping is a personal display preference, and browser-local persistence matches that demand without wire, schema, or settings-document churn.

**Read-only grouping without delete/remove affordances.** Rejected with the user; both delete-group and remove-member ship.

**Computed facets (by source or enablement) instead of user groups.** Rejected: named user collections were the stated need; computed facets remain possible later as additional pseudo-groups.

## Consequences

The inventory becomes organizable without touching the deployment, and nothing model- or wire-visible changes. Groups do not roam across browsers or Host homes (documented limitation). The component and store suites hold the package's per-file 100% coverage gate; the `settings-chrome` e2e drives create → add → reload persistence → cleanup through the assembled app, so the golden row markup stays pinned alongside the new columns.
