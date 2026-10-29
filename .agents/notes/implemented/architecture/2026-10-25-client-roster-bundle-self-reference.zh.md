# Agent Note: Client roster 解析 bundle 自引用

Status: implemented

[English](2026-10-25-client-roster-bundle-self-reference.md) | 中文

## Problem

bundle patch 可以挂载自身的 Host 运行时包。在链接式 pnpm 安装中，包的实际目录不一定有指回自身的依赖链接。只搜索依赖目录会在整机客户端测试启动前拒绝该行；另一个 bundle 的安装目录可能掩盖这一缺口。

## Decision

[roster 读取器](../../../../packages/test-support/client-runtime/src/assembly/bundle-roster.ts) 在 manifest 锚点识别 bundle 自身包名，并使用该实际 manifest。其他包查找保留按目录深度交错搜索的规则：任一 bundle 旁的依赖优先于无关祖先目录中的包。Host-only 行在 manifest 发现后过滤，自身运行时行也遵循此规则。

[Client 包拓扑](2026-08-15-client-shells-and-dynamic-packages.zh.md)继续规定生产加载方式。本决策只涉及 Node 测试装配中的元数据发现。

## Alternatives considered

- 添加自依赖或依赖根目录提升：这会错误描述安装图，使严格安装依赖偶然存在的链接。
- 按锚点顺序完成各自的整条依赖搜索：第一个 bundle 的祖先包可能覆盖后一个 bundle 的直接依赖。

## Consequences

整机客户端测试无需制造自引用链接即可读取链接式 bundle 的自身运行时行。浏览器 roster 仍排除 Host-only 包，并保留依赖优先级。
