# Agent Note: Client rosters resolve bundle self references

Status: implemented

English | [中文](2026-10-25-client-roster-bundle-self-reference.zh.md)

## Problem

A bundle patch can mount its own Host runtime package. With a linked pnpm installation, that package's real directory need not have a dependency link back to itself. Searching only dependency directories then rejects the row before the whole-client test can start. Another bundle's installation directory can hide the omission.

## Decision

The [roster reader](../../../../packages/test-support/client-runtime/src/assembly/bundle-roster.ts) recognizes a bundle's own package name at its manifest anchor and uses that real manifest. Other package lookups retain the interleaved dependency-directory search: a dependency next to any bundle wins over an unrelated ancestor package. Host-only rows are filtered after manifest discovery, including a bundle's own runtime row.

The [Client package topology](2026-08-15-client-shells-and-dynamic-packages.md) continues to own production loading. This decision concerns metadata discovery by the Node-only test assembly.

## Alternatives considered

- Add a self dependency or rely on root hoisting: this misstates the installation graph and leaves strict installations dependent on an incidental link.
- Resolve each anchor's complete dependency search in order: an ancestor of the first bundle can override a direct dependency of a later bundle.

## Consequences

Whole-client tests can read a linked bundle's own runtime row without manufacturing a self link. The browser roster still excludes Host-only packages and preserves dependency precedence.
