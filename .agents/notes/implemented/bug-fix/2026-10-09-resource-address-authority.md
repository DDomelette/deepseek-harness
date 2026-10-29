# Agent Note: The resource protocol key is read from the address text

Status: implemented

English | [中文](2026-10-09-resource-address-authority.zh.md)

## Problem

`protocolOf(address)` decided a resource address's protocol with `new URL(address).hostname`. A phone WebView that reached a `dsh web` LAN deployment through the pairing flow reported an empty `hostname` for `dsh-resource://file/…` and left the authority in `pathname`, so every `file` address looked like an address with no protocol: the registered `file` provider was never reachable from the holder, every `useResource<'file'>` answer stayed `none`, and the right Sidebar's document preview — which reads a file only once its protocol has a provider — showed "文件资源服务不可用。" for every file while chat, tool cards, and the file tree kept working. The same Session and the same file rendered in a desktop browser, whose URL parser reports `file` as the host.

A probe rendered inside the failing page pinned the failing step: `urlHost=(empty)`, `meta=none`, `sameRegistry=true`, `wfRegistered=true`. The provider was registered in the registry the hook reads and the plugin had applied; only the protocol key was missing. Replaying the same engine behavior in a desktop browser reproduced the failure exactly, and the fix below removed it.

## Decision

`protocolOf` reads the authority out of the address text: it requires the case-insensitive `dsh-resource://` prefix, takes everything up to the first `/`, `?`, or `#`, and returns it lower-cased — or `undefined` when there is no authority or the address is not a resource address. `new URL` no longer participates, so no engine's parser decides whether an address names a protocol.

Client code must not read a `dsh-resource://` address through `new URL`. The URL specification leaves a non-special scheme's authority to the implementation, implementations disagree, and the resource model's key must not move with them. [`packages/client/resources`](../../../../packages/client/resources/README.md) owns the grammar; [the client resource model](../architecture/2026-09-05-client-resource-model.md) records the model this key belongs to.

## Alternatives considered

**Keep `new URL` and patch `URL` in the browser floor.** Rejected: [`installBrowserCompat`](../../../../packages/client/web/src/compat.ts) installs a floor for APIs an engine lacks, and rewriting a global constructor would change behavior for every bundle and for custom-scheme strings the resource model does not own.

**Parse the address with the `file` grammar (`parseFileAddress`).** Rejected: that grammar is `file`-specific, while `protocolOf` is the protocol-generic key for every entry in `ResourceProtocolMap`; routing it through one protocol's parser makes the next protocol's addresses a special case.

**Drop the provider-present gate in the document preview so it reads anyway.** Rejected: the gate is where "the file service is present" is decided, and every other `useResource` consumer would still read `none`; the preview would become the one surface that cannot tell a missing service from a missing file.

**Treat a hostless address as a resource.** Rejected: a navigation address such as `sidebar://guide` must stay a non-resource, and the Sidebar's tab registry depends on the two families never mixing.

## Consequences

The protocol key no longer depends on a parser's normalization: an authority is taken verbatim and lower-cased, so an address carrying userinfo or percent-escapes yields a key the parser would have normalized differently. Addresses this code composes never do; `packages/client/resources` pins both the parser-independent cases (another scheme, a bare path, an empty authority) and a stubbed `URL` whose custom-scheme `hostname` is empty, which must still yield `file` for `dsh-resource://file/session/s1/a.txt`.

Engine variance still reaches `new URL` uses that read a *path* out of an address: the Sidebar's path-only globs (`pathOf` in `ui-sidebar-right`) see `//file/session/…` on such an engine. `basename` matching keeps every shipped pattern working, and a later path-shaped pattern must not assume the parser's answer. [The browser floor](2026-09-12-browser-floor-for-the-web-shell.md) covers APIs an engine lacks; this note covers an API whose answer differs.
