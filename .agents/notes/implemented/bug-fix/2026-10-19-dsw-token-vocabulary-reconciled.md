# Agent Note: Feature stylesheets reference only defined `--dsw-*` tokens

Status: implemented

English | [中文](2026-10-19-dsw-token-vocabulary-reconciled.zh.md)

## Problem

A `var(--dsw-*)` whose name no sheet defines resolves to its fallback, or to the guaranteed-invalid value when it carries none, so the property silently keeps its initial value. Twenty-one token names referenced from feature stylesheets in `packages/client` had no definition in `packages/client/ui-theme/src/styles/`, and neither the current sheets nor the pre-merge fork's `design-platform.css` defines them. Borders, fills, disabled labels, state labels, and code font families therefore rendered with whatever literal each site happened to carry, or not at all: the terminal status band, the settings skills and archived rows, the job list's live-card fill and monospace labels, the document preview's and plugin manager's code text, and the settings form's error label.

## Decision

`packages/client/ui-theme/src/styles/` is the token authority, and every feature reference now names a definition it declares:

| Referenced name | Defined replacement | Consumers |
|---|---|---|
| `--dsw-alias-bg-l1` | `--dsw-alias-bg-layer-1` | ui-sidebar-terminal |
| `--dsw-alias-bg-l2` | `--dsw-alias-bg-layer-2` | ui-sidebar-terminal |
| `--dsw-alias-bg-layer-4` | `--dsw-alias-interactive-bg-hover` | ui-primitives settings form, ui-settings-subagent |
| `--dsw-alias-border-secondary` | `--dsw-alias-border-l2` | ui-settings-skills |
| `--dsw-alias-surface-primary` | `--dsw-alias-bg-layer-1` | ui-settings-skills |
| `--dsw-alias-surface-secondary` | `--dsw-alias-bg-layer-2` | ui-settings-skills |
| `--dsw-alias-state-error-label` | `--dsw-alias-state-error-primary` | ui-settings-skills |
| `--dsw-alias-label-error` | `--dsw-alias-state-error-primary` | ui-primitives settings form |
| `--dsw-alias-label-quaternary` | `--dsw-alias-label-tertiary` | ui-agent-preset, ui-sidebar-browser |
| `--dsw-alias-separator-primary` | `--dsw-alias-label-tertiary` | ui-chat |
| `--dsw-alias-fill-l1` | `--dsw-alias-interactive-bg-hover` | ui-jobs |
| `--dsw-alias-fill-l2` | `--dsw-alias-interactive-bg-hover-solid` | ui-jobs |
| `--dsw-alias-fill-tertiary` | `--dsw-alias-interactive-bg-hover` | ui-attachment |
| `--dsw-alias-fill-tsp-secondary` | `--dsw-alias-interactive-bg-hover` | ui-agent-preset |
| `--dsw-color-text-secondary` | `--dsw-alias-label-secondary` | ui-settings-archived |
| `--dsw-color-border` | `--dsw-alias-border-l2` | ui-settings-archived |
| `--dsw-color-warning` | `--dsw-alias-state-warn-label` | ui-settings-archived |
| `--dsw-color-danger` | `--dsw-alias-state-error-primary` | ui-settings-archived |
| `--dsw-font` | `--dsw-font-family` | ui-sidebar-documentpreview |
| `--dsw-font-mono` | `--dsw-font-family-code` | ui-agent-preset, ui-jobs, ui-plugin-manager, ui-sidebar-documentpreview, experimental client-ui-claude-code-mods |
| `--dsw-font-sm-13` | `--dsw-font-xs-13` | ui-tool |

Each replacement is a name the sheets declare, checked against `design-platform.css` for the palette and semantic aliases and against `base.css` for the font stacks; the literal or font-stack fallbacks that kept the old declarations resolvable are removed. Two shipped adjustments follow from the mappings rather than from a separate decision. `ArchivedSection`'s row divider names a neutral border token now, so it draws the 0.5px hairline the elevation stylesheet contract requires of neutral solid borders. `terminal.module.css` paints `--dsw-alias-bg-layer-2` while its `.empty` state scrolls, so the pane declares the l2 scrollbar pair the scrollbar contract requires of a sheet that scrolls on an elevated surface.

`--dsw-font-family-code` is the one added token. `packages/client/ui-theme/src/styles/base.css` declares it on `:root` and on `body`, beside `--dsw-font-family` and `--dsw-font-family-brand`, and it resolves to `--ds-font-family-code`, the stack the user code-font list already parameterizes. It belongs in `base.css` because that sheet owns the font tokens, and it names the existing code stack instead of restating a family list; the seven feature sites that spelled `--dsw-font-mono` read it.

## Names that are not defects

Three names in the referenced-but-undefined diff are not broken references and are unchanged:

- `--dsw-elevation-*` is a wildcard inside a comment in `packages/client/ui-theme/src/styles/gradient-shadow-text.css` that explains per-element rebinding; the comment is prose, not a `var()` call.
- `--dsw-hovercard-bg` is a component-local property that `packages/client/ui-primitives/src/HoverCard.module.css` both declares and reads, which the styling ownership rule allows.
- `--dsw-radius-missing` is a fixture string in `packages/client/ui-theme/tests/radius-styles.client.spec.ts` that proves the radius scanner reports an unknown radius token.

## Enforcement

`scripts/verify-client-token-vocabulary.ts` fails any `var(--dsw-*)` whose name no sheet in `packages/client/ui-theme/src/styles/` declares, reporting `file:line: --token (no definition)`. The theme sheets are the whole definition authority: a feature sheet's own declaration cannot satisfy a reference from another sheet, because custom properties inherit only through the element tree. `--dsw-hovercard-bg` is the single allowlisted component-local property, and test sources sit outside the scan, so the `--dsw-radius-missing` fixture needs no allowlist entry. The gate runs beside `client-ui-i18n` in `ci-primary`, `ci-static`, and `check-all`, and refuses a narrowed stylesheet corpus or a scan that finds suspiciously few references.

## Alternatives considered

**Add the twenty-one names to `design-platform.css`.** Rejected: their values would be invented. No sheet in this repository defines them, so there is no source value to restore, and the families they imply — `--dsw-alias-fill-*` and `--dsw-color-*` — name no rung of the palette.

**Invent a per-feature token name inside the stylesheet that needs it.** Rejected by the styling ownership rule: a shared color or font decision belongs to the theme package, and a one-off name in a feature module is exactly the drift the token sheets exist to prevent.

**Keep the per-site literal fallbacks and map only the names.** Rejected: those fallbacks are what kept the declarations resolvable, so the theme never reached them, and several were literal colors the component rules forbid.

## Consequences

- Borders, fills, disabled labels, state labels, and code font families resolve through the defined vocabulary, and the removed fallbacks make a future rename fail visibly instead of silently reverting to an initial value.
- The reference set loses twenty-one stale names, so the token sheets now describe the whole vocabulary the feature stylesheets use.
- Any future token added for a component stylesheet lands in the theme sheets beside its family; a name that no sheet defines is a defect in the caller.
- A reference to a name no theme sheet declares fails `pnpm run verify-client-token-vocabulary` instead of rendering with the property's initial value.
