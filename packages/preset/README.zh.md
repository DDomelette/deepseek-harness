---
description: "preset 组地图：按会话从 preset 文件组装 agent，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# packages/preset

[English](README.md) | 中文

## 概述

preset 组提供按会话的 agent（智能体）组装：一个 agent preset 就是一行 `@deepseek-ai/dsh-agent-preset` 声明，其 `plugins` 是普通的 Cordis 条目列表；从 preset 组装的会话会使用该 preset 的工具、提示词段落与 skill（技能），而其他会话仍各自使用自己的。`agent-preset-registry` 拥有名单与代际保留，`agent-preset` 贡献声明行并随包交付组合创作 skill，`persona` 则提供可组装的人设行。四个随附 preset（`standard`、`ptc`、`minimal`、`cordis`）以 `dsh-web-app` bundle 的 `presets/<id>.patch.yml` 文件形式交付。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`agent-preset-registry`](agent-preset-registry/README.zh.md) | preset 名单：已声明的定义、会话加入的常驻挂载与代际保留 | `ctx.agentPresets` |
| [`agent-preset`](agent-preset/README.zh.md) | 一行 `@deepseek-ai/dsh-agent-preset` 声明，以及 `cordis` preset 挂载的组合创作 skill | — |
| [`persona`](persona/README.zh.md) | preset 挂载的可组装人设行，用于遮蔽或替换部署级人设 | — |

-----

<a id="related-documentation"></a>
## 相关文档

- [`AgentPresets` 参考](../../docs/subsystems/core.zh.md#ctxagentpresets--agentpresetregistry)——发现、挂载、继承与重组。
- [Scope 子系统](../../docs/subsystems/scope.zh.md)——scope key，以及挂载接入 agent 时所用的父链。
- [系统提示词子系统](../../docs/subsystems/system-prompt.zh.md)——preset 提示词段落如何注册与组装。
- [按会话组装 agent preset 的 Agent Note](../../.agents/notes/implemented/architecture/2026-08-03-per-session-agent-presets.zh.md)——设计理由与备选方案。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
