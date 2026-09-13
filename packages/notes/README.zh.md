---
description: "notes 包组：把会话素材留存为笔记、并让每条笔记在各自会话中由配置的模型作答的 Web 笔记面板，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# notes/ — Web 笔记面板

[English](README.md) | 中文

## 概述

notes 组留存用户希望日后回看的素材：对话中的一段文字选区或一张截图成为一条笔记。配置的模型在各自的会话中逐条作答，因此笔记的问题与后续追问都留在产生该素材的会话之外。本组唯一的包承载面板的两个半侧：Host 半侧拥有笔记的存储领域、指定作答模型的设置命名空间，以及笔记运行所在的会话；浏览器半侧拥有收集、列出并打开笔记的面板。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

本组唯一的包承载面板的两个半侧。

| 包 | 职责 |
|---|---|
| `notes/` | Web 笔记面板：把会话中的文字与截图收集为笔记，并让配置的模型在各自的会话中逐条作答 |

-----

<a id="related-documentation"></a>
## 相关文档

- [存储子系统](../../docs/subsystems/storage.zh.md)——保存所收集笔记的领域形式。
- [设置子系统](../../docs/subsystems/settings.zh.md)——指明哪一模型作答某条笔记的用户设置命名空间。
- [会话子系统](../../docs/subsystems/session.zh.md)——记录每条笔记会话的会话日志。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
