# Agent Note: Worker async delegation preserves return values

Status: implemented

English | [中文](2026-10-24-worker-delegation-return-values.zh.md)

## Problem

Worker dependencies also use named default declarations, module-local `createRequire`, callback canonical paths, and streaming helpers. Losing those bindings or omitting the module faces prevents Host services from activating. Worker images include dependency modules whose async generators use `return yield* source`. A transform limited to delegation statements cannot pack those modules. Discarding the return would change the generator's completion value.

## Decision

The [module transform](../../../../packages/experimental/webworker-runtime/src/compile/transform.ts) lowers a delegation statement or a direct return operand. It forwards yielded values and consumer input through the existing suspension protocol. A direct return propagates the exhausted iterator's value; cancellation closes an unfinished iterator. Enclosing assignments and calls remain rejected because replacing their complete statement would discard other operations. Consumer `throw()` forwarding remains unsupported.

Named default declarations keep their declaration and publish a getter. Static imports initialize before module statements. Named and default imports retain live bindings; `eslint-scope` identifies references without rewriting lexical shadows or property names. Shorthand properties preserve their keys and imported function calls preserve their receiver semantics. Generated module requests capture the image resolver outside the ESM lexical block, so a local `require` can coexist with static and dynamic imports. The compatibility table reuses the maintained stream implementation and provides callback `realpath.native` over the VFS. Native package installation through `execa` and Node OTLP event transmission through `got` are explicit refusing external replacements, like other native-only packages. Their unsupported IPC and socket dependencies stay outside the image; inventory reads can activate without implying that installation or telemetry export works in the browser. Unsupported readline operations also refuse explicitly.

The preview document declares a directory base. A filename without a query string must not become the RPC mount; both the empty and fixture-backed entries use the same directory.

The lowering version changes whenever emitted code changes, so the worker refuses an image compiled for incompatible wrapper semantics. The [Client package topology](2026-08-15-client-shells-and-dynamic-packages.md) continues to own Client module identity and loading; this decision only defines async-generator lowering in the Worker image.

## Alternatives considered

- Remove the dependency from the image: its runtime consumer still needs the module.
- Accept arbitrary `yield*` expressions: the statement rewrite cannot preserve their surrounding operations.
- Treat delegation as a statement even under `return`: that loses the inner completion value.

## Consequences

The preview can pack direct-return delegation without adding a compiler to the Worker. Transform tests cover values, input forwarding, cancellation, line numbers, and refusal of enclosing expressions. The packed preview must still boot through the real Worker and page tunnel.
