# Agent Note: Iterator global shim for pdfjs-dist on pre-ES2025 browsers

Status: implemented

English | [中文](2026-09-11-iterator-global-shim.zh.md)

## Problem

The document-preview sidebar bundles pdfjs-dist, which polyfills `Iterator.prototype.join` at import time through a bare reference to the `Iterator` global (pdf.mjs). Browsers predating the ES2025 Iterator global (Safari < 18.4, Chrome < 117) throw a ReferenceError at that reference; because the failure happens while the Client loads the plugin tree, the entire Web UI goes blank on those browsers — including phone browsers that a LAN deployment exists to serve. PC browsers current enough to carry the global are unaffected.

## Decision

The Web shell owns a browser floor (`packages/client/web/src/compat.ts`), installed by `AppWebEntry.run()` before it imports a single bundle. It defines the `Iterator` global when absent, with `prototype` set to the intrinsic %IteratorPrototype% — the object generator iterators already inherit from — recovered at runtime via `Object.getPrototypeOf` on a generator's prototype chain. The polyfill pdfjs writes then lands where its call sites (`.join(sep)` on generator iterables) can reach it. The floor's other entries and the scripts that must run ahead of it are covered by [Browser floor for the Web shell](2026-09-12-browser-floor-for-the-web-shell.md).

## Alternatives considered

- **Ship a full Iterator Helpers polyfill (core-js).** Rejected: the entire surface is needed for one method (`join`) at one import site; core-js's module graph costs every browser real bytes for a single shim.
- **Patch the pdfjs-dist bundle.** Rejected: the bare reference is upstream code; a maintained patch on a vendored build artifact re-breaks on every pdfjs upgrade.
- **Require Iterator-capable browsers.** Rejected: it narrows the browser range that already works, and the failure mode (blank page) gives the user no actionable signal.

## Consequences

- Pre-ES2025 browsers boot the Web UI again; the floor runs before any plugin import and costs nothing on current browsers (the guard skips it).
- The shim covers exactly pdfjs's `Iterator.prototype.join` usage; any future Iterator Helpers usage (`map`, `filter`, …) on those browsers needs a real polyfill instead.
- The shim is shell-owned, so every bundle the shell boots inherits the coverage; it still spans only `join`-style prototype writes.
