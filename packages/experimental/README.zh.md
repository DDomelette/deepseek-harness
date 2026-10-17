---
description: "实验组地图：默认私有的预稳定原型，以及显式公开发布的 Agent Teams 包。"
kind: "package-group"
---

# packages/experimental

[English](README.md) | 中文

## 概述

实验组包含约定可能变更且不提供支持承诺的原型能力。包默认私有；五个 Agent Teams 包是显式公开发布的例外，并保留现有 `@deepseek-ai/dsh-experimental-*` 名称。本组还包含私有的跨 realm Inspector、CPython 子进程后端与浏览器 worker 预览包。组外已发布产品不得依赖实验性包。

## 目录

- [实验性、可选与官方](#status)
- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="status"></a>
## 实验性、可选与官方

**实验性**表示整个公开能力仍在评估中，不属于产品支持承诺。其行为或 API 可能变更，能力也可能被撤回；工程、安全、文档、测试和已发布数据的义务仍然适用。只有其完整公开约定均为实验性或仅限内部使用的包才属于本组；产品包中的实验选项仍归原产品职责所有。

**可选**表示用户显式选择该能力。**官方**表示项目维护并在插件页列出该包。两者均不表示成熟度；发布、默认安装和界面可见性也不决定成熟度。组外产品包承担维护职责，其公开 API 仍遵循仓库的预稳定政策。

晋升需要明确的产品职责、公开行为与限制、当前消费者、发布内容以及测试证据。晋升时将包移入对应产品组，应用该组的命名规则，并同时更新受影响的消费者。[子树规则](AGENTS.md)规定依赖隔离和发布要求。

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`agent-team-profile`](agent-team-profile/README.zh.md) | Agent Teams 的公开 opt-in profile 层 | — |
| [`agent-team`](agent-team/README.zh.md) | 具名 teammate，成员之间持久消息与共享任务板 | `ctx.agentTeams` |
| [`agent-team-web-profile`](agent-team-web-profile/README.zh.md) | Agent Teams 的公开 opt-in Web 层 | — |
| [`client-ui-agent-team`](client-ui-agent-team/README.zh.md) | Web Team roster、任务板与 teammate 导航 | — |
| [`ptc-runtime-python`](ptc-runtime-python/README.zh.md) | PTC 执行 seam 的 CPython 子进程后端 | `ctx.ptcRuntime` |
| [computer-use-cua-driver-mcp](computer-use-cua-driver-mcp/README.zh.md) | 通过 MCP 使用已安装的 Cua Driver | `ctx.computerUse` |
| [computer-use-cua-driver-native](computer-use-cua-driver-native/README.zh.md) | 嵌入 Cua Driver 原生 npm 运行时 | `ctx.computerUse` |
| [`browser-use-playwright-mcp`](browser-use-playwright-mcp/README.zh.md) | 通过 MCP 提供 Playwright 浏览器工具 | `ctx.browserUse` |
| [`browser-use-chrome-devtools-mcp`](browser-use-chrome-devtools-mcp/README.zh.md) | 通过 MCP 提供 Chrome DevTools 检查与浏览器控制 | `ctx.browserUse` |
| [`browser-use-stagehand-native`](browser-use-stagehand-native/README.zh.md) | Stagehand 浏览器操作与显式配置的原生模型 | `ctx.browserUse` |
| [`browser-use-runtime`](browser-use-runtime/README.zh.md) | 实验性提供方共享的 Session 浏览器资源 | — |
| [`inspector`](inspector/README.zh.md) | 用于 Host 调试、Client Runtime 检查、网络采集与 Cordis 树的跨 realm CDP hub | `ctx.inspector` |
| [`tool-agent-team`](tool-agent-team/README.zh.md) | 让模型创建、发消息与协调 teammate 的九个工具 | 按作用域注册工具到 `ctx.tools` |
| [`webworker-packer`](webworker-packer/README.zh.md) | 构建浏览器 worker 预览所消费的 gzip 压缩虚拟文件系统（VFS）镜像 | 库与 CLI（命令行界面），不使用 ctx key |
| [`webworker-runtime`](webworker-runtime/README.zh.md) | 在专用浏览器 worker 中运行 harness 插件树 | 库与 worker 入口，不使用 ctx key |

-----

<a id="related-documentation"></a>
## 相关文档

- [实验包决策](../../.agents/notes/implemented/architecture/2026-08-18-experimental-agent-teams-packages.zh.md)——默认私有、Agent Teams 公开例外与依赖隔离。
- [Agent Teams 子系统](../../docs/subsystems/agent-team.zh.md)——持久 Team 类型与 `ctx.agentTeams` 服务 API。
- [计算机操作](../../docs/subsystems/computer-use.zh.md)——桌面提供方选择。
- [浏览器操作](../../docs/subsystems/browser-use.zh.md)——浏览器提供方选择与 Session 所有权。
- [实验子树规则](AGENTS.md)——实验状态放宽了什么、不放宽什么。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
