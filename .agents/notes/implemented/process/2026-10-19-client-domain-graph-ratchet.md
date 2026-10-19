# Agent Note: Ratchet the client domain-graph gate against a baseline

Status: implemented

English | [中文](2026-10-19-client-domain-graph-ratchet.zh.md)

## Problem

`scripts/verify-client-domain-graph.ts` enforces the layering rule for `packages/client/*/src/client/`: domain directories never import a sibling domain, `contract/` is the only shared layer, and only `apply.ts`/`index.ts` may assemble across domains ([Web client architecture note](../architecture/2026-07-19-gui-web-client-architecture.md)). On the tree that landed this decision the gate reported 83 specifiers — 54 sibling-domain imports and 26 from top-level non-assembly files — spread over `ui-sidebar-documentpreview` (38), `ui-sidebar-browser` (19), `ui-settings-account` (15), `ui-workspace` (4), `ui-conversation` (3), and `ui-chat` (1), and exited 1 on every run. `scripts/run-gates.ts` registered it only in the local `check-all` aggregate, which no CI job runs, so no lane ever observed the exit code. An unregistered check carries no signal: the violation count could grow or shrink without a reviewer seeing it, and re-enabling the check required cleaning up all 83 imports first.

The 83 specifiers are 80 distinct violations because `ui-sidebar-documentpreview/src/client/TextPreview.tsx` imports two sibling specifiers five times in total: three imports of `./text/lines.ts` and two of `./document/registry.ts`. Any count the gate prints or baseline it stores therefore has to distinguish occurrences from identities.

## Decision

The gate ratchets against a checked-in baseline instead of demanding absolute cleanliness. `scripts/client-domain-graph.baseline.json` records every violation the tree contained when the decision was made; a run fails on a violation absent from the file and on a baseline entry that no longer reproduces, and only an exact match exits 0. The recorded set can therefore shrink on purpose and cannot grow silently, which keeps the [quality-gates note](2026-06-11-quality-gates.md) rule that every mechanically checkable promise has a command that exits non-zero.

Discovery is syntax-aware. Each Client source is parsed with the TypeScript parser, so import declarations, re-exports, `import = require(...)`, and dynamic `import()` all count, a specifier inside a comment or string never counts, and reformatting a file cannot change the result. On the tree that landed this decision the parsed set was identical to the previous `from '...'` regular-expression set, zero added and zero removed, so baselining dropped no violation and detected no new one. Discovery also fails when it finds fewer than 500 Client source files, matching the sibling Client gates, so a narrowed checkout cannot report a clean gate.

`pnpm exec tsx scripts/verify-client-domain-graph.ts --write` (alias `--update-baseline`) rewrites the baseline from the current tree and exits 0. The script's top JSDoc documents the command, [the Web client rules](../../../../packages/client/AGENTS.md) record it in one sentence, and the commit message that landed the ratchet repeats it.

`ciSharedStaticGates()` registers the gate, so `ci-primary`, `ci-static`, and the Windows observational lane run it beside `client-packages` and `client-ui-i18n`; the local `check-all` aggregate keeps its existing entry.

## Baseline identity and staleness

An entry is the repository-relative importer path plus the imported specifier, both `/`-separated, sorted by importer and then specifier. Line and column are deliberately absent: the identity must survive an unrelated edit that moves the import within its file, otherwise every reformat invalidates the baseline and the ratchet turns into recurring maintenance. Occurrences collapse by that identity, so the checked-in file holds 80 entries for 83 specifiers, and a second import of the same specifier in the same file needs no second entry.

A stale entry fails the run instead of warning. With a warning, a reduction in violations would never force the file to shrink: the baseline would keep identities that no longer reproduce, the accepted count would stop describing the tree, and the next real growth could pass unnoticed among obsolete entries. Failing in both directions is what keeps the file a true inventory of accepted debt.

## Alternatives considered

**Clean up all 83 violations now.** Rejected because they cause no user-visible defect and break no product path. Repairing them means moving shared CSS modules and store helpers into each package's `contract/`, which is large churn spread across Client packages and carries visual-regression risk that only the browser snapshot lane can price. Enforcing the rule first and paying the debt down separately keeps both jobs reviewable.

**Leave the gate red and out of CI.** Rejected because that is the state that produced the 83. Nothing reads its exit code, so it cannot catch the next violation, and its count has no owner.

**Register the gate as red and fix the code in one change.** Rejected because a required lane that fails on untouched code blocks every unrelated change until the cleanup lands, which inverts the outage the gate exists to prevent.

**Key the baseline by file and line.** Rejected because line numbers move under any edit above the import, so the baseline would fail for reasons unrelated to the layering rule and would need regeneration far more often than violations change.

**Report stale entries as information and pass.** Rejected for the reason in the previous section: the file would drift out of date with no gate failing, and shrinking it would depend on someone remembering to run `--write`.

## Consequences

Any change that fixes, moves, or removes a baselined import turns the gate red until `pnpm exec tsx scripts/verify-client-domain-graph.ts --write` regenerates the baseline, and that regeneration belongs in the same change as the fix. This is intentional: it is the mechanism by which the debt shrinks. Adding a new sibling-domain import fails immediately, including a side-effect CSS import that the previous regular expression could not see.

The gate is cheap enough for the static lane: on the Windows host that landed this decision it takes 2.6-3.2 seconds over 773 Client source files (3.2 seconds through `pnpm run`, the gate-runner entrypoint).

Both directions are verified with the baseline committed. The gate prints `773 Client source file(s) match the 80 accepted violation(s).` and exits 0; a scratch file under `ui-workspace/src/client/session-actions/` importing `../rows/Rows.module.css` exits 1 naming exactly `packages/client/ui-workspace/src/client/session-actions/RatchetScratch.ts -> ../rows/Rows.module.css`; after the scratch file was deleted the gate exited 0 again. `scripts/verify-client-domain-graph.spec.ts` pins every admitted and excluded import form, both ratchet directions, the `--write` flow, the corpus floor, and the unknown-argument rejection.

The baseline records accepted debt, not a verdict about which imports are legitimate. Shrinking it is ordinary work: fix a violation, run `--write`, commit the smaller file with the fix. When no violation remains the file holds an empty `entries` array, and deleting it outright also passes, because a missing baseline is read as empty.
