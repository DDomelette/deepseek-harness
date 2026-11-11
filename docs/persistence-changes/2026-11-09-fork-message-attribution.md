---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-09-fork-message-attribution

English | [中文](2026-11-09-fork-message-attribution.zh.md)

## Summary

Records the notes, tool-cordis, and fixture message-source labels as producer-owned attribution.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-09-fork-message-attribution
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-27-retry-control-input"
    after: "f20da3423ed3d2452f33548231bf0362959802d2e096459ce93df7d0838435fa"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-27-retry-control-input"
    after: "f5ef498e5c56d95722e9f9578a9c0eaf2fb7c2a242ac7cd08230fc78135abdec"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-27-retry-control-input"
    after: "bf5b7e9c5b978f63f8d57822ccabcf74739f51c96bb6ffff5aa97cccf8a71c2d"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-27-retry-control-input"
    after: "b43ff7e745430a64aad9418ae0a99bc0493d6542a119aea68da889300010ae41"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The additions identify where a message came from. Existing source kinds and message fields retain their meaning. Readers without these producers preserve the kind and JSON metadata and derive the same message content. The Session format and prior committed generations stay intact.

<a id="verification"></a>
## Verification

Ran the native source admission suite. All 44 tests passed across uncompressed and Zstandard read and write handles, including preservation without the producer and unchanged on-disk bytes.

<a id="dev-note"></a>
## Dev Note

None.
