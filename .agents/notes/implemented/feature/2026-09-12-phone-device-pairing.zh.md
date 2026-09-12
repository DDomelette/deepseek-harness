# Agent Note: 手机设备配对

Status: implemented

[English](2026-09-12-phone-device-pairing.md) | 中文

## 问题

手机过去靠打开 `dsh web` 为电脑自己打印的那个 URL 来访问 Web GUI：进程令牌就在该 URL 里，交换出来的 cookie 与电脑持有的是同一个、绑定同一 authority，并在整个 `cookieMaxAgeDays` 内有效。任何看到该 URL 的人——截图、共享剪贴板、肩后一瞥——都拿到了电脑自身的会话；而不轮换签名密钥、不把电脑自己也踢下线，就无法只结束某一台手机的访问。部署里也没有任何东西区分两台手机，操作者既说不出当前连着哪台设备，也谈不上吊销它。

## 决策

手机以**已配对设备**的身份被接纳，而不是作为电脑会话的副本。

电脑用 `POST /pair/session` 开启一次请求，得到 8 位短码（字母表不含 `0/O` 与 `1/I`），存活 120 秒、只可使用一次。手机打开 `/pair?c=<code>` 认领它，轮询界面读取 `/pair/state`；这两条手机路由都接受尚无 cookie 的请求——手机此刻本就没有 cookie。其余配对路由（`/pair/session`、`/pair/requests`、`/pair/approve`、`/pair/devices`、`/pair/revoke`）都要求浏览器会话**且**来自回环 authority，因此唯一能接纳设备的，是坐在电脑前的人。

批准会以从手机 user agent 推导、并在面板里可改的名称登记该设备；手机下一次 `/pair/state` 轮询即带回决定与设备 cookie。该 cookie 是第二种 cookie 形式：载荷为 `{version: 2, authority, deviceId, issuedAt, expiresAt}`，寿命由 `deviceCookieMaxAgeDays`（默认 180）在签发时固定，绝不因使用而续期。`BrowserAuth.isAuthenticated` 只在 `client-connection/paired-devices` 凭据记录仍列出该设备时才接受它，因此吊销会在该手机的下一次请求生效，既不需要重启 Host，也不影响电脑自己的 cookie。v1 启动令牌 cookie 完全不变，回环交接因此保持原样。

`ctx.connection.devices` 拥有登记表——`list`、`register`、`revoke`、`touch`；每次变更都会刷新运行中的 cookie 校验。`touch` 最多每小时推进一次设备的最后可见时间，使普通请求不会反复改写凭据文件。配对会话本身受三重约束：32^8 的短码空间、120 秒寿命，以及按来源限流（每 10 秒 10 次读取，连续 5 次失败后锁定 60 秒）。

## 曾考虑的替代方案

- **借 DeepSeek 官方登录。** 否决：dsh 没有可供认证的账号体系——设置里只有 API key 或 provider id，harness 自身的身份是匿名文件 `~/.dsh/.anonymous-user-id`——也没有公开的第三方 OAuth/OIDC 端点可把局域网浏览器委托过去；而登录并不能消除手机到电脑这一段明文窗口。它会给一项本不需要账号的能力加上外部依赖。
- **手机号或短信登录。** 否决：需要短信服务商、用户数据库与找回流程，而本 harness 都没有，且这项部署的合法使用者本来就只有房间里的人。
- **继续用打印出的 URL 作为手机的凭据，二维码里带一份 per-phone secret。** 否决：以同样方式发放的秘密仍然无法按设备吊销，也无法区分持有它的手机。
- **让已配对的手机批准下一台手机，或通过 `/api` 的 Remote 方法批准。** 否决：能接纳设备的设备，等于让"持有局域网地址"就足以加入；而且它会把决定搬到一个手机也能到达的通道上。回环要求是"有人正坐在电脑前"的唯一可得证据，因此设置面板走与手机相同的 `/pair*` 路由，而不是新增 Remote 孪生方法。
- **设备 cookie 滑动续期。** 否决：被盗的 cookie 只要一直被使用就永远有效。固定寿命加显式吊销，才是操作者能据以推理的东西。

## 后果

- `/pair` 提供应用外壳本身——经由 `frontend-static` 提供的 `frontend` 服务——并携带 `__DSH_PAIR__` 启动事实；手机的配对界面渲染在 `shell.overlay` 之上，cookie 到手后即离开到 `/`，因此手机运行与电脑相同的应用产物。
- 手机接入部署现在有两种凭据形式需要推理：进程启动令牌（回环、行为不变、通过删除 `client-connection/browser-session` 吊销）与设备 cookie（局域网、通过 `POST /pair/revoke` 按设备吊销）。
- 吊销对运行中的 Host 立即生效，因为每次登记表变更都会刷新内存中的设备集合；损坏到无法解释的设备记录会让操作显式失败，而不是被覆盖。
- 手机到电脑这一段仍是明文 HTTP：网络上的观察者可以读到配对轮询与传输中的设备 cookie，而该 cookie 不带 `Secure` 属性，因为该传输无法兑现它。自签名或 mkcert 证书的 TLS 是单独一期，它才会关上这扇窗并让该属性可以设置。
- `apps/cli/tests/pairing.e2e.ts` 通过真实 CLI 走完整条握手：取码、手机侧未认证界面、仅回环可决定、设备 cookie 让 `/api` 认证通过、已配对手机被拒绝做出决定、吊销让同一 cookie 变成 401，以及按来源锁定。
- [LAN Web 服务](../architecture/2026-09-11-lan-web-serving.zh.md)仍是绑定、栅栏与明文 HTTP 警告的权威；本笔记负责"手机是什么、如何被接纳"。[手机接入归入 web profile](../architecture/2026-09-12-phone-access-in-the-web-profile.zh.md)仍是入口归属的权威。
