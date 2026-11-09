# Agent Note：「连接手机」设置页与保存的绑定策略

Status: implemented

[English](2026-11-08-connect-phone-page-and-bind-policy.md) | 中文

## 问题

手机接入入口原本只是「设置 → 通用设置」里的一行：它打开一个弹窗，而在部署仅绑定回环时，弹窗只能报告 `mob/no-advertised-origin`，唯一的补救是用 `--host` 重新启动。操作者一旦选定了局域网地址也无处保存，而行本身也没有空间显示或编辑下次启动将绑定的地址。

## 决策

本组合包改为注册一个 `settings.section`（id 为 `mobile`，order 12，标签「连接手机」），不再使用通用设置行。页面保留既有配对面板，并在其上方加入「访问地址」区块，通过经操作者认证的 `/pair/bind` 路由编辑 `dsh-web-app` 的 `web-startup` 配置：`bindMode` 取 `loopback`、`auto` 或 `fixed`，`bindHost` 为固定地址。该路由就是这条策略的写入路径：Remote 装配同样把设置 RPC 的写入保留给操作者，而本页保留自己的、仅操作者可达的端点，因此在任何设置表单挂载之前就能读取并保存这条策略。

当调用未指定 `--host` 时，由 `web-startup` 解析回退绑定地址：`loopback` 保持 `127.0.0.1`，`fixed` 绑定去掉首尾空白的 `bindHost`（地址为空会让启动失败，而不是静默回落），`auto` 取操作系统路由所用网卡的地址——用 UDP `connect` 探测，不发送任何数据包——探测不到时回落到保存的 `bindHost`，再回落到第一个非内部 IPv4，最后回落到回环。解析结果随 `webStartup.bind` 发布，webserver 行绑定 `ctx.webStartup.host ?? ctx.webStartup.bind.host`；对指定了 `--host` 的那次调用，旗标仍然优先。

保存的改动在下次启动生效，因为监听器在任何页面加载之前就已绑定。设置写入仍仅限回环页面（`ui-settings` 让非回环页面的表单保持进程内），因此已配对手机只看到地址信息与「仅操作者可用」的说明、看不到控件；操作者在任何自己打开的页面（包括局域网地址）上都能改。

## 备选方案

- **默认绑定局域网地址。** 这是最初提出的形态，也是本页面存在的理由。按操作者的选择否决：新起的 `dsh web` 会在没有任何显式决定的情况下，把 GUI 暴露给机器加入的每一个网络。
- **把地址持久化到独立文件。** 否决：设置/配置管线已经把每个条目的用户层保存在 profile patch 中，并提供带修订栅栏、经操作者认证的写入路径；再建一份持久文件属于重复实现。
- **按网卡名挑选局域网地址。** 否决：虚拟网卡（VMware、VirtualBox、Docker）会与真实网卡并列枚举，而按名称匹配正是此前虚拟网卡工作必须修补的失效方式。路由表才指明流量实际使用的网卡。
- **保留通用设置行，另开一个地址弹窗。** 否决：页面必须同时呈现配对控件与地址——没有可达 origin 的部署根本没有配对链接——而设置外壳本来就把「有自己一组设置」的页面放在分区里。

## 影响

- 设置 → 连接手机 是唯一的加入入口：地址区块说明本页自身的地址、手机能否访问、保存的模式，以及需要重启；其下的配对面板不变。
- `--host` 仍可在单次调用中覆盖；保存的策略管辖未指定地址的启动，`loopback` 仍是随附默认值。
- 自动模式绑定默认路由使用的地址。若机器的路由在两次启动之间变化，可能绑定不同地址；页面在重启后报告实际结果。
- 操作者从自己打开的任何页面（包括局域网地址）编辑该策略；`--host` 仍可覆盖单次启动，已配对手机既不能读也不能改。`n- 换一个绑定地址或端口会让每台手机重新配对：设备 cookie 的名称与签名都绑定它的 authority，页面会提示这一变化会让既有配对失效。
- 手机看到的页面没有地址区块，因为它的设置镜像是进程内的。

## 测试

`packages/bundle/web-app/tests/startup.spec.ts` 覆盖旗标发布、经真实 Loader 树的固定策略、解析器的四种结果，以及用脚本化的 `node:dgram` 与 `node:os` 覆盖的网卡探测；`packages/bundle/mob/tests/apply.client.spec.ts` 覆盖分区注册、注入的写入路径与销毁；`packages/bundle/mob/tests/section.client.spec.tsx` 覆盖地址区块、已保存/失败提示、只读部署与配对面板；`apps/web/tests/phone-pairing.e2e.ts` 在真实 Web 服务器上回放两份 golden。

## 相关

- [只绑定一个具体 Web 地址](../architecture/2026-09-19-concrete-web-bind-address.zh.md)——本策略回落的「具体地址」规则与回环默认值。
- [手机接入归入 web profile](../architecture/2026-09-12-phone-access-in-the-web-profile.zh.md)——该层的注册与配对归属。
- [LAN Web 服务](../architecture/2026-09-11-lan-web-serving.zh.md)——监听器周围的栅栏、警告与启动令牌交换。
