# Agent Note：cookie 会重复，映射回环也是回环

Status: implemented

[English](2026-10-07-wire-cookie-and-loopback-forms.md) | 中文

## 问题

两个第三梯队缺陷位于浏览器与 Host 之间的线缆上。

桥接层用 `Object.fromEntries(response.headers.entries())` 构造响应头。`set-cookie` 是唯一可以重复的响应头——设置两个 cookie 的路由会产生两条 header entry，而对象只保留最后一条——随后 `writeHead(status, headers)` 又覆盖了请求路径用 `setHeader` 暂存的任何 cookie，而设备 cookie 的续期正是这样在路由运行前暂存的。于是触发续期的那次响应本身就可能把它丢掉，而路由自己的多个 cookie 也会只剩一个。

回环分类认识的形式少于各平台实际报告的。`isLoopbackHostname` 只接受 `localhost` 与 `[::1]`，于是 `localhost.`（同一名字的绝对形式，浏览器可能发送）以及 `[::ffff:7f00:1]` 这类 IPv4 映射字面量都被当成远端 authority；`isLoopbackPeer` 只接受 `::1`，于是双栈监听器以 `::ffff:127.0.0.1` 报告 v4 回环对端时，通不过守护配对决定的回环检查。

## 决定

桥接层自己收集响应头：每个 `set-cookie` 值按顺序保留，派发前暂存的值前置，结果以列表写出。对 node:http 而言单个 cookie 就是一个单元素列表，两种写法发出的都是同一条 header。

`isLoopbackHostname` 去掉一个结尾点，并把 IPv4 映射的 IPv6 字面量还原成它携带的 IPv4 地址（点分形式与两段十六进制形式都支持），再套用既有的 127/8 判定；对端屏蔽表新增 `::ffff:127.0.0.0/104`，即 127/8 的映射形式。

## 考虑过的替代方案

**只转发最后一个 cookie。** 不采纳：静默丢掉一个 cookie 就是会话缺陷，而该 header 的定义就是可重复。

**让续期路径在路由作答之后再设置 cookie。** 不采纳：路由的响应由共享代码产生，而它已经写了自己的头；在桥接层合并是唯一能同时看到两者的位置。

**把所有 `::ffff:` 字面量都当回环。** 不采纳：映射形式携带任意 IPv4 地址，`::ffff:192.168.1.6` 必须保持远端。只有映射后的 127/8 段算回环。

**先用 `new URL()` 规范化主机名再分类。** 不采纳：该谓词接收的正是 URL 解析器已经产出的主机名，二次解析反而会拒绝它必须分类的括号形式。

## 后果

一次既续期设备 cookie 又设置自身 cookie 的响应，会带着全部 cookie 以确定的顺序到达客户端。以 `localhost.` 或映射字面量访问 GUI 的浏览器被识别为本机，其配对决定与普通 `127.0.0.1` 走同一道栅栏，而映射后的局域网地址仍是远端。本笔记拥有的两条清单项已在[配对待修清单](../../proposed/bug-fix/2026-10-06-phone-access-and-web-surface-defect-backlog.zh.md)中标记为已修。
