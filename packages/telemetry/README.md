---
description: "Local provider usage recording and optional HTTP delivery."
kind: "package-group"
---

# telemetry/ — provider usage

English | [中文](README.zh.md)

## Summary

Record provider-reported token usage locally and optionally deliver those records to an HTTP endpoint. Usage capture is independent of canonical Session event reporting in the [session telemetry subsystem](../../docs/subsystems/session-telemetry.md).

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

- [usage-telemetry](usage-telemetry/README.md) records usage per provider attempt; the base composition enables recording.
- [usage-exporter](usage-exporter/README.md) owns delivery and durable cursors; its shipped entry is disabled.

<a id="dev-note"></a>
### Dev Note

None.
