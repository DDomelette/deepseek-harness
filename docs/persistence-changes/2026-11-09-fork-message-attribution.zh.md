---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-09-fork-message-attribution

[English](2026-11-09-fork-message-attribution.md) | 中文

## 概述

将 notes、tool-cordis 和 fixture 消息来源标记登记为生产方拥有的归属信息。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

新增标记描述消息来自哪里。现有来源种类和消息字段保留原有含义。未加载这些生产方的读取器会保留种类和 JSON 元数据，并派生相同的消息内容。Session 格式及已提交的旧世代保持完整。

<a id="verification"></a>
## 验证

运行原生来源接纳测试。44 项测试通过，覆盖未压缩和 Zstandard 的读写句柄，并验证没有生产方时仍能保留来源及磁盘字节。

<a id="dev-note"></a>
## 开发备注

无。
