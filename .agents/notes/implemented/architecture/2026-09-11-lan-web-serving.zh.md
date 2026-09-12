# Agent Note: 显式 --allow-lan 把关下的 LAN Web 服务

Status: implemented

[English](2026-09-11-lan-web-serving.md) | 中文

## 问题

从手机操作 Web UI 需要经 LAN 访问 Host，但随附 CLI 曾一概拒绝 `--host 0.0.0.0`：`/api` 面包含远程代码执行级别的方法，而[浏览器信任栅栏](2026-07-28-api-browser-trust-boundary.zh.md)与[浏览器令牌认证](2026-08-24-browser-token-authentication.zh.md)在设计时都无意暗示支持网络部署。没有操作者自建的代理，移动端访问就不可能——即使在风险可接受的受信家庭网络上也是如此。

## 决策

`dsh web` 只在同时给出显式 `--allow-lan` 旗标时接受 `--host 0.0.0.0`（`dsh-web-app/startup`）；没有该旗标，调用仍是点名该旗标的用法错误。绑定所有网卡会在挂载时打印 stderr 警告：明文 HTTP 意味着网络上任何拿到会话 cookie 的人都会获得完全控制权，因此该模式仅限受信网络。信任栅栏与令牌认证不变：`resolveLanTrust` 把机器的 LAN IP 字面量推导进 `trustedHosts`，因此 LAN authority 能通过 Host 栅栏，而每个 API 调用仍要求 authority 绑定到 LAN host 与 port 的浏览器 cookie——在电脑上完成启动令牌交换所得，或某台已配对设备自己的 cookie（[手机设备配对](../feature/2026-09-12-phone-device-pairing.zh.md)）。推导规则：从展示与栅栏中同时排除 198.18.0.0/15 fake-ip 段（RFC 2544 基准段，被 Clash 式 TUN 协议栈占用）与 169.254.0.0/16 链路本地段（未完成 DHCP 的网卡），并按接口名把虚拟/隧道网卡（VMware、WSL、Docker、TUN/TAP VPN、WireGuard、Tailscale、ZeroTier）稳定排序到物理网卡之后，使打印与扫码的地址是手机真实可达的地址；虚拟地址仍保留在结果中，供纯虚拟部署（如仅 Tailscale）使用，且就绪行会打印其余候选地址，因为排序只是名称启发式。

`web` profile 组合了手机接入组合包（`@deepseek-ai/dsh-mob`），因此在局域网提供服务只有上面这条 CLI 路径：该组合包不打任何补丁，`--allow-lan` 管辖每一次调用，挂载时的 stderr 警告伴随该绑定。该层自身的决策归[手机接入归入 web profile](2026-09-12-phone-access-in-the-web-profile.zh.md)所有。

`mob` bundle 同时携带浏览器半层：设置 → 通用设置中的「连接手机」行打开配对面板，它通过 `POST /pair/session` 向 Host 申请一次性短码，把不带进程令牌的 `/pair?c=<code>` 链接（局域网 origin）渲染成二维码，并把待确认的请求与已配对的设备并列展示。[手机设备配对](../feature/2026-09-12-phone-device-pairing.zh.md)拥有该握手及其签发的设备 cookie；`mob.joinUrl` Remote 方法仍经共享的 `resolveJoinUrl` helper 从同一份栅栏快照拼出局域网 origin。快照为空时，loopback 绑定以 `mob/loopback-only` 失败，而 all-interfaces 绑定推导不出可达地址时以 `mob/no-lan-address` 失败，因为两者的纠正方式不同（启用局域网绑定，或修复本机网络）。

## 曾考虑的替代方案

- **保持一刀切拒绝；文档化反向代理。** 否决：代理要求每个移动端用户为一项部署额外运行基础设施，而栅栏与认证已把该部署保护到与 loopback 部署相同的水平。
- **在认证就位后完全取消守卫。** 否决：裸 `--host 0.0.0.0` 读起来像常规绑定选项；显式旗标让安全相关的选择在调用点可见，stderr 警告在每次启动时陈述残余的明文风险。
- **LAN 服务默认启用 TLS。** 在本变更中否决：仓库今天没有维护在手机上配置证书的路径；cookie 沿用 loopback 时代的设计而不含 `Secure`，加入 TLS 属于另一项部署约定。

## 后果

- 网络上的手机通过打开打印出的 LAN URL（或扫描「连接手机」入口渲染的二维码）加入；一次性令牌交换签发与 loopback 流程相同的签名 cookie。
- `mob.joinUrl` 向持有 cookie 的客户端发放新的 token URL，不扩大攻击面：持 cookie 者本就拥有完整 Host API 权限。
- 残余风险：令牌交换与每个已认证请求都以明文传输；窃取 cookie 的网络攻击者将持有它直到过期，或直到 `client-connection/browser-session` grant 记录被删除且进程重启（既有的全局撤销）。
- 两份前身笔记仍是栅栏与认证的有效权威；本笔记只取代它们「CLI 拒绝 `--host 0.0.0.0`」的后果陈述。
