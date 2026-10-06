# Agent Note: The index entry is identified by the file it resolves to

Status: implemented

English | [中文](2026-10-06-index-entry-resolved-identity.zh.md)

## Problem

The fallback seat decided whether a request names the application shell by comparing the resolved request path against the configured index path as strings: `target === distRoot || target === distIndex`. On a case-insensitive volume — NTFS and a default APFS, which are the platforms `dsh web` ships on — `/INDEX.html` names the same file as `/index.html` while comparing unequal, so the request fell into the public static branch and the file was read case-insensitively: the shell was served as a static asset with `200 text/html`, without `authorizeIndex`, and therefore without Connection's browser authentication or the Host/Origin fence. The recorded run on this machine returned `200` with the raw shell for `/INDEX.html` where `/index.html` returns the authenticated refusal. The module's own contract ("Every index response first passes Connection's browser authentication") and `README.md` ("an untrusted name never receives the application") both say an authority the fence rejects must not receive the shell, and an alias path bypassed both. The shell is not a secret — a trusted authority without a cookie receives it as a 401 — so the exposure is the invariant, not the bytes; on Linux the same request is a 404, which is why the shipped tests never saw it.

## Decision

The entry is identified by the file the path resolves to. `isIndexEntry` keeps the exact comparisons as the fast path and, for every other candidate, compares `realpathSync.native` of the target against `realpathSync.native(distIndex)`. A path that cannot be resolved is not the entry, and the caller's read reports the same 404 it would have reported anyway. Resolution also covers a symlink pointing at the index file, which now takes the authenticated path as well.

## Alternatives considered

- **Compare lowercased paths.** Rejected: it makes every case-distinct file on a case-sensitive filesystem an index request, so a deployment that really ships `INDEX.html` next to `index.html` would serve the shell instead of that file.
- **Detect the volume's case sensitivity once and compare case-insensitively only there.** Rejected: the detection is itself a filesystem probe with the same failure modes, and it still misses aliases that are not about case (a symlink to the index, an 8.3 short name on NTFS).
- **Reject any non-exact path whose lowercase form equals the index path.** Rejected as incomplete for the same reason, and it turns a legitimate asset into a 403 instead of serving it.
- **Leave it and document the alias.** Rejected: the fence is a security boundary the repository states twice, and the fix is two `realpath` calls on the paths that are not already the exact index.

## Consequences

- `/INDEX.html` now takes the same path as `/index.html`: an unauthenticated loopback request is the minimal 401 refusal, a trusted LAN authority receives the shell marked as needing authentication, and a paired device receives the ordinary shell through `renderIndex` (taps and injections included).
- Every static request that is not the exact index pays two `realpath` syscalls; the exact paths keep the comparison-only fast path.
- A case-distinct file on a case-sensitive volume is unaffected: resolution fails or returns a different file, so it stays a static asset.

## Testing

- `packages/host/frontend-static/tests/frontend-static.spec.ts` requests `/INDEX.html` and `/Index.HTML` in the real Loader composition, probing the fixture volume for case-insensitivity and asserting both branches: on a case-insensitive volume the anonymous request is `401 text/plain` and the authenticated one is `200 text/html` carrying an active index tap (proof it went through `renderIndex`, not a static read); on a case-sensitive volume both are 404. Without the change the recorded run reports `expected [ '/INDEX.html', 200, … ] to deeply equal [ '/INDEX.html', 401, … ]`.
- The Windows CI job runs the case-insensitive branch; the Linux job runs the other.
