# Agent Note: Module references and Cordis product identifiers

Status: implemented

English | [中文](2026-10-25-rescope-preserves-product-identifiers.zh.md)

## Problem

The `cordis` preset id, Client locale namespaces, and `cordis/*` event keys are registered product data. Changing their spelling changes preset selection, translation lookup, or producer/consumer agreement. The framework package has a separate publication name, `@deepseek-ai/cordis`.

## Decision

The [rescope codemod](../../../../scripts/rescope-vendor.ts) preserves product tokens through exact file/vendor-name entries. Explicit module selectors in those same files still follow the package mapping: imports, declaration merges, module resolution, and module mocks. Forward and reverse rewrites preserve the product values.

Raw package-name acceptance inputs belong to the [codemod fixture](../../../../scripts/rescope-vendor.spec.ts). The repository scan excludes only that fixture file so these inputs retain their original names.

## Alternatives considered

- Rewrite every quoted `cordis` token: changes registered product data and can corrupt event names or persisted preset choices.
- Exclude every token in a product-owning file: leaves actual package imports unresolved and prevents reverse rewriting of those imports.

## Consequences

A new product-id site needs an explicit reviewed file/name entry. Other names and unlisted files retain the ordinary rewrite rules. A file exception does not exempt its module imports from the package mapping.

The original publication rationale is recorded in the [archived decision](../../archived/process/2026-08-10-vendor-package-rescope.md). The [current mapping](../../../../docs/rescope.md) owns published names; this note owns the distinction between package references and product identifiers.
