# Agent Note：配置的载体上限约束一次激活的每条缓冲路由

Status: implemented

[English](2026-10-07-rpc-channel-body-cap.md) | 中文

## 问题

`maxRequestBodyBytes` 只到达了一条路由。`apply` 从配置读出它、按图片批量做断言，并把它交给共享 `/api` 路由的 bridge；而 `HostConnectionService.register`——`connection.rpc.handle` 背后紧邻 `/api` 的 channel 注册表——调用同一个 bridge 时没有传它。因此不论部署配置成什么，channel 都按内置的 300 MiB 默认值缓冲：操作者改了上限，实际只改了共享路由，README 所记录的"每请求常驻上限"对 channel 流量并不成立。

## 决定

激活只解析一次上限并交给服务：`HostConnectionService` 把它作为构造字段接收，`register` 在构建路由时读取一次并传给 bridge。在注册时读取而不是在请求处理器内读取，使这个限制不依赖 Cordis 每次调用解析出的 `this`。因此 `ConnectionConfig.maxRequestBodyBytes` 约束该次激活的每条缓冲载体路由，JSDoc、包 README 的载体段落与内存限制条目都如此陈述。

## 考虑过的替代方案

**给构造函数参数加默认值，让 channel 继续用内置上限。** 不采纳：记录在案的每请求上限仍然不描述 channel 流量。

**channel 用内置默认值，共享路由用配置值。** 不采纳：一次激活里两个上限没有所有者，操作者也无从判断是哪条路由回了 413。

**在 `register` 上暴露每 channel 上限。** 不采纳：上限是这次激活的载体属性，不是每个调用方的选择；当前没有任何消费方需要不同的值。

## 后果

调低或调高 `maxRequestBodyBytes` 的部署会同时移动每条缓冲路由，因此 channel 上的 413 与 `/api` 上的 413 意味着同一个限制。超限的请求体在处理器运行之前就被拒绝，连接测试套件对两个方向都做了固定：512 字节上限下 4 KiB 信封得到 413 且处理器未被调用，同一条 channel 上的小信封仍能到达处理器。本笔记拥有的清单项已在[配对待修清单](../../proposed/bug-fix/2026-10-06-phone-access-and-web-surface-defect-backlog.zh.md)中标记为已修。
