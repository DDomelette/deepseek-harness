# Agent Note: 显式 --allow-lan 把关下的 LAN Web 服务

Status: implemented

[English](2026-09-11-lan-web-serving.md) | 中文

## 问题

从手机操作 Web UI 需要经 LAN 访问 Host，但随附 CLI 曾一概拒绝 `--host 0.0.0.0`：`/api` 面包含远程代码执行级别的方法，而[浏览器信任栅栏](2026-07-28-api-browser-trust-boundary.zh.md)与[浏览器令牌认证](2026-08-24-browser-token-authentication.zh.md)在设计时都无意暗示支持网络部署。没有操作者自建的代理，移动端访问就不可能——即使在风险可接受的受信家庭网络上也是如此。

## 决策

`dsh web` 只在同时给出显式 `--allow-lan` 旗标时接受 `--host 0.0.0.0`（`dsh-web-app/startup`）；没有该旗标，调用仍是点名该旗标的用法错误。绑定所有网卡会在挂载时打印 stderr 警告：明文 HTTP 意味着网络上任何拿到会话 cookie 的人都会获得完全控制权，因此该模式仅限受信网络。信任栅栏与令牌认证不变：`resolveLanTrust` 把机器的 LAN IP 字面量推导进 `trustedHosts`，因此 LAN authority 能通过 Host 栅栏，而每个 API 调用仍要求以启动令牌交换来的 cookie，且该 cookie 的 authority 绑定到 LAN host 与 port。

随附 profile `mob`（叠加在 `dsh-web-app` 之上的 `@deepseek-ai/dsh-mob`）通过其 bundle patch config 设置 `host: 0.0.0.0`——这条路径从不解析 CLI 旗标，因此 `--allow-lan` 守卫不适用，挂载时的 stderr 警告为两条路径共同承载安全提示。

`mob` bundle 同时携带浏览器半层：设置 → 通用设置中的「连接手机」行打开二维码弹窗，调用 `mob.joinUrl` Remote 方法，向已认证客户端发放与终端播报器打印相同的带 token LAN URL——经共享的 `resolveJoinUrl` helper 从同一份栅栏快照拼出。

## 曾考虑的替代方案

- **保持一刀切拒绝；文档化反向代理。** 否决：代理要求每个移动端用户为一项部署额外运行基础设施，而栅栏与认证已把该部署保护到与 loopback 部署相同的水平。
- **在认证就位后完全取消守卫。** 否决：裸 `--host 0.0.0.0` 读起来像常规绑定选项；显式旗标让安全相关的选择在调用点可见，stderr 警告在每次启动时陈述残余的明文风险。
- **LAN 服务默认启用 TLS。** 在本变更中否决：仓库今天没有维护在手机上配置证书的路径；cookie 沿用 loopback 时代的设计而不含 `Secure`，加入 TLS 属于另一项部署约定。

## 后果

- 网络上的手机通过打开打印出的 LAN URL（或扫描 `mob` profile 打印的二维码）加入；一次性令牌交换签发与 loopback 流程相同的签名 cookie。
- `mob.joinUrl` 向持有 cookie 的客户端发放新的 token URL，不扩大攻击面：持 cookie 者本就拥有完整 Host API 权限。
- 残余风险：令牌交换与每个已认证请求都以明文传输；窃取 cookie 的网络攻击者将持有它直到过期，或直到 `client-connection/browser-session` grant 记录被删除且进程重启（既有的全局撤销）。
- 两份前身笔记仍是栅栏与认证的有效权威；本笔记只取代它们「CLI 拒绝 `--host 0.0.0.0`」的后果陈述。
