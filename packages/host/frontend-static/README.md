---
description: "SPA dist server for the Web shell: claims the webserver fallback seat and serves the built frontend with traversal rejection and SPA index fallback."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-frontend-static

English | [中文](README.zh.md)

## Summary

Serve the built Web shell to browsers from its configured distribution directory. The root and configured index path render the bootstrapped index; existing assets are served directly, while missing or non-file paths return 404, traversal returns 403, and unsupported methods return 405. Index access requires a valid process token or browser cookie, but static assets remain public. Only one instance can handle unmatched routes at a time; a second activation fails, and unloading the active instance makes unmatched requests return 404.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose this plugin in a browser-facing host that serves the built Web shell: it claims the webserver's fallback seat and answers every request no named route matches. It needs one config value — where the built frontend's `index.html` lives.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-host-frontend-static'
  config:
    distIndex: /absolute/path/to/dist/index.html
```

`distIndex` is an assembly fact of the composing application: [`dsh-web-app`](../../bundle/web-app/README.md) resolves it through the frontend package's exports and mounts this plugin; a deployment never hardcodes it.

### What the server enforces

Requests are served from the dist root (the directory containing `distIndex`). The dist root and the configured index path render `index.html` with HTTP 200; any other existing file is served directly with its MIME type, and unknown extensions ship as `application/octet-stream`. A path that resolves outside the root is rejected with 403, so a crafted path cannot read files above the dist. An absent or non-file target inside the dist root — a missing file, a directory, or a missing configured index — returns an empty 404. Non-GET/HEAD requests without a matching named route are answered 405. The fallback is a webserver resource. Every successful index response is rendered through the webserver's `renderIndex` — for `connection.browserPeer`, the Peer Connection's browser authentication admits, over HTTP, and for `peer` in a `webServer.readResource(request, peer)` read, which skips browser authentication — so the boot manifest and that Peer's access snapshot reach the page on `/` and on the configured index path.

Root and configured-index requests pass the HTTP socket address to `ctx.connection.authorizeIndex` before reading HTML. A valid process token receives a 303 redirect with the persistent browser cookie. A valid cookie serves the index, and the response includes any device cookie renewal staged by Connection. An unauthenticated loopback request or a request that fails the Host and Origin checks receives a plain 401. An unauthenticated request from another trusted authority receives the shell with status 401 and `__DSH_AUTH_REQUIRED__`, which `@deepseek-ai/dsh-mob` uses to prompt for pairing. Connection owns the [authentication decisions](../../client/connection/README.md#browser-authentication-and-request-trust).

Static files outside the index are public.

Browsers revalidate every served file except the index. Such a response carries `cache-control: no-cache` and a weak ETag built from a SHA-1 of the file's bytes, so a file whose content changes gets a new ETag even when its name stays the same; a request whose `If-None-Match` equals the current ETag receives an empty 304. The rendered index carries no cache headers.

### Observable failures

Traversal returns 403 rather than an error page. An absent or non-file target inside the dist root returns an empty 404, so a stale link or a mistyped pathname is an explicit failure rather than a silent SPA fallback. Claiming the seat twice throws, and while the seat is unclaimed the webserver answers 404 — which is what a browser sees if this plugin's fiber is disposed.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The package is one function plugin around `serveStatic`, which maps a Fetch `Request` to a `Response`: `apply` resolves the dist root from `distIndex` and registers a fallback resource under an effect scope. For each request the resource passes `serveStatic` an `authorizeIndex` closure, which runs `ctx.connection.authorizeIndex` only when no Peer came with the request, and a `renderIndex` closure that runs `ctx.webServer.renderIndex` over the raw `index.html` for that Peer or the browser Peer and splices the document base in after the opening head tag (after the raw taps, so it precedes their markup too). The seat is single-owner by the webserver's contract — a second registration throws — and effect-scoped, so disposing the fiber releases the seat.

### The traversal fence

`serveStatic` normalizes the requested pathname and joins it to the dist root, then requires the target to be the root itself or stay under it. The check uses `sep` rather than `/` because `resolve()` emits backslash paths on Windows, where a `/` suffix would reject every legitimate subpath as traversal.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `serveStatic` and `apply`: fallback resource, traversal rejection, index authorization and rendering, revalidation, MIME table |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the serving contract is not enough: the seat owner's contract, then the composition that resolves the dist and the subsystem reference.

- [Webserver](../webserver/README.md) — the fallback seat this plugin claims and the index taps it runs.
- [dsh-web-app bundle](../../bundle/web-app/README.md) — the application that resolves `distIndex` and mounts this plugin.
- [HTTP server subsystem](../../../docs/subsystems/web-server.md) — how the fallback seat fits the route tables.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-host-frontend-static) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

None, as the SPA dist server answers browser asset requests and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when a served asset class is not yet covered. They are current package constraints, not a task backlog.

- **The starter MIME table is minimal** — it covers the Vite-emitted asset set, the shipped PWA manifest, and the icon fonts (`.woff2`/`.woff`/`.ttf`) and images (`.png`/`.svg`) the shell bundles; other extensions fall back to `application/octet-stream` until an asset class ships.
- **Pathname routing is explicit** — the current client enters through the root or configured index path and has no History API pathname routes. Adding one requires an explicit server rule and real-composition coverage rather than a broad fallback for every miss.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The only owned relation is the single fallback seat, which cannot be probed from the teardown stream — `internal/plugin` fires before the disposing fiber's effects run, so the legitimate owner still holds the seat at notification time and any claim probe would false-positive on every correct disposal (unlike the webserver companion, whose reserved-path probes never collide with a live registration). The seat's register/release symmetry is covered by the package's real-composition HMR-safety test instead.
