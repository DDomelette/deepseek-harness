# Agent Note: 局域网推导识别 VirtualBox host-only 网卡

Status: implemented

[English](2026-10-06-virtual-adapter-derivation-covers-virtualbox.md) | 中文

## 问题

`resolveLanTrust` 靠匹配网卡名把物理网卡排在虚拟与隧道网卡之前，而它的 JSDoc 把「VMware/VirtualBox host-only 网段」列在自己覆盖的家族里。模式里却没有任何 VirtualBox 词项，于是 Windows 上的 `VirtualBox Host-Only Network`、Linux 与 macOS 上的 `vboxnet0` 被当作物理网卡，参与竞争 `lanAddresses[0]`——那个地址既被就绪行最先打印，也是「连接手机」二维码的唯一输入。host-only 网卡本机可达、手机永远不可达，因此配对链接指向手机打不开的地址，而二维码没有候选兜底（只有就绪行会列出其余候选）。macOS 上 Docker Desktop 的 `bridge100` 以同样方式被漏掉，因为 `^br-` 只锚定 Linux 的命名。

## 决策

模式新增 `virtualbox`、`vbox`（同时覆盖 `vboxnet0`）与 `^bridge\d`（macOS Docker Desktop 网桥），JSDoc 也把这些形态写明。

## 备选方案

- **按地址段排序。** 否决：host-only 网段与真实局域网段重叠（`192.168.56.0/24` 对 `192.168.1.0/24`），没有任何地址规则能把它们分开。
- **向操作系统询问网卡类型。** 否决：`os.networkInterfaces()` 不报告这一事实，而按平台枚举会把一个名称启发式换成好几个。
- **优先拥有默认路由的那块网卡。** 否决：Node 不暴露路由表，而为同一个启发式去 shell 调用 `route print` 或 `ip route` 只会给启动增加一个平台相关的失败模式。

## 后果

- 同时装有 VirtualBox host-only 网卡与物理网卡的机器，如今把物理地址排在第一位，因此就绪行与配对二维码都指向手机可达的地址。
- 该启发式仍是一份名称清单；其他厂商的 host-only 网卡需要自己的词项，这一点由 JSDoc 记为约定。
- 其余候选地址仍会打印、仍受栅栏保护，因此被这份清单排错序的地址仍可通过复制下一个候选来使用。

## Testing

`packages/bundle/web-app/tests/web-app.spec.ts` 先对同时含 `VirtualBox Host-Only Network`、`bridge100` 与物理 `en0` 的网卡表断言推导顺序，再对 `vboxnet0` 与 `en0` 断言。没有这些词项时，第一条断言报出 `192.168.56.1` 排在 `192.168.1.5` 之前。
