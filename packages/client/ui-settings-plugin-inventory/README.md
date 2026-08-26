# @deepseek-ai/dsh-client-ui-settings-plugin-inventory

English | [中文](README.zh.md)

Read-only **Plugin list** tab for Web Settings. The browser plugin registers one localized `settings.plugins.tab` contribution with id `all`; the Plugins section owns the navigation entry and tab chrome. It performs no Remote read during plugin activation. Selecting the tab for the first time mounts it and lazily calls `ctx.remote.pluginInventory.list()` through [`api-remotes`](../../api/remotes/README.md).

The tab renders a two-column view: a groups pane on the left and a searchable catalog of compact disclosure cards on the right. The groups pane lists the reserved **All** group plus user-defined groups with their live membership counts; its **New group** button opens a name dialog, and a selected custom group can be deleted from its row. Selecting a group filters the catalog to its members and reveals an **Add plugins** button whose searchable picker adds entries by checkbox; a member card offers removal from the group. Groups are a display overlay persisted browser-locally in localStorage (`dsh.plugin.groups.v1`) — membership references stable Loader entry ids and never mutates the deployment. Each collapsed card uses the short module name as its title and a small effective-enablement tag; enabled entries also show a colored root-fiber status dot. A title wider than the card loops horizontally instead of truncating, and inside a custom group the tag collapses to just the status dot — gray when the entry is disabled. Expanding one card reveals its Loader-tree entry id without a redundant field label, followed by the effective configuration and, for enabled entries, Cordis status. Disabled entries omit the redundant unmounted runtime state. The entry id remains the React key, disclosure identity, detail value, and an additional search target; it is never classified by string shape. Loading, empty, no-match, and generic failure states stay local to the mounted component, and a failed read can be retried without exposing transport details. The registration uses `ctx.slots.inject()`, so it follows late tab declaration, redeclaration, locale changes, and teardown without importing the section owner.

## Model Experience

None, as this package only visualizes a Host-owned deployment snapshot in browser Settings and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One snapshot per Settings mount or retry** — the tab does not subscribe to Loader changes or automatically refetch after reconnect; switching tabs preserves the current snapshot, while reopening Settings obtains a new one.
- **Read-only Loader view** — grouping is a browser-local display overlay; local search does not add provenance, current-browser activation diagnosis, grouping by source, or plugin mutation controls.
- **Groups stay in this browser** — user groups persist in localStorage and are not synchronized across browsers, devices, or Host homes; membership ids of entries no longer deployed are filtered out by presence, so a group can silently shrink.
