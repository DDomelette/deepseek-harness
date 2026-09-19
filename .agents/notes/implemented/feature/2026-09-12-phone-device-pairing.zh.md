# Agent Note: 手机设备配对

Status: implemented

[English](2026-09-12-phone-device-pairing.md) | 中文

## 问题

手机过去靠打开 `dsh web` 为电脑自己打印的那个 URL 来访问 Web GUI：进程令牌就在该 URL 里，交换出来的 cookie 与电脑持有的是同一个、绑定同一 authority，并在整个 `cookieMaxAgeDays` 内有效。任何看到该 URL 的人——截图、共享剪贴板、肩后一瞥——都拿到了电脑自身的会话；而不轮换签名密钥、不把电脑自己也踢下线，就无法只结束某一台手机的访问。部署里也没有任何东西区分两台手机，操作者既说不出当前连着哪台设备，也谈不上吊销它。

## 决策

手机以**已配对设备**的身份被接纳，而不是作为电脑会话的副本。

电脑用 `POST /pair/session` 开启一次请求，得到 8 位短码（字母表不含 `0/O` 与 `1/I`），存活 120 秒、只可使用一次。手机打开 `/pair?c=<code>` 认领它，轮询界面读取 `/pair/state`；这两条手机路由都接受尚无 cookie 的请求——手机此刻本就没有 cookie。其余配对路由（`/pair/session`、`/pair/requests`、`/pair/approve`、`/pair/devices`、`/pair/revoke`）都要求有效的启动令牌 cookie、回环 authority 和真实的回环 TCP 对端。设备 cookie 即使绑定回环 authority 也不授予该权限；调用者可控制的 Host 或转发请求头不能证明对端的位置。

批准会以从手机 user agent 推导、并在面板里可改的名称登记该设备；手机下一次 `/pair/state` 轮询即带回决定与设备 cookie。决定与设备行同时公布：被允许的请求在登记写入设备行之前保持 pending，因此在这段窗口里轮询的手机继续等待，而不会收到一个 cookie 指向空处的批准；若设备行与短码过期发生竞争而落败，该行会被吊销而不是留在列表里。该 cookie 是第二种 cookie 形式：载荷为 `{version: 2, authority, deviceId, issuedAt, expiresAt}`，到期于 `client-connection/paired-devices` 记录为该设备保存的交付窗口——登记时为 `deviceLifetimeDays`（默认 30），之后由操作者设定——且绝不因普通使用而续期（[按设备的设备寿命](2026-09-13-device-lifetime-authority.zh.md)）。`BrowserAuth.isAuthenticated` 只在 `client-connection/paired-devices` 凭据记录仍列出该设备时才接受它，因此吊销会在该手机的下一次请求生效，既不需要重启 Host，也不影响电脑自己的 cookie。登记表跟随记录本身而不只是自身的写入：Connection 在该键每次 `credentials/record-updated` 时重新读取它，操作者直接编辑文件、或第二个进程吊销设备，都由此抵达运行中的 Host。

要让吊销真正"完整"，还需要另一半规则：进程启动令牌是电脑自己的凭据，因此 `authorizeIndex` 只在 authority 与 TCP 对端均为回环时交换它，`isAuthenticated` 接受启动令牌 cookie 时也要求两者均为回环。于是 `dsh web` 打印的局域网 URL 不带令牌，`mob.joinUrl` 返回的是面板拼配对链接所用的、无令牌的局域网 origin，而每个非回环客户端——手机、平板或第二台电脑——都用自己的设备 cookie 认证。此前由局域网 authority 签发过的启动令牌 cookie 从此被拒绝，因此对手机而言"吊销"重新成为完整的答案。

不带会话到达的手机也会被告知如何取得会话，而不是撞上死路。对非回环 authority 上的拒绝，`authorizeIndex` 回答 `auth-required`，于是 `frontend-static` 以 401 提供外壳本身并携带 `__DSH_AUTH_REQUIRED__` 启动事实，浏览器半层据此在 `shell.overlay` 上渲染「需要重新登录」界面，指出电脑端创建新配对码的设置项。回环上的拒绝仍保留纯文本 401，而被 Host/Origin 栅栏拒绝的 authority 根本拿不到外壳：操作者能照那段文字行事，不可信的名字则什么都得不到。

`ctx.connection.devices` 拥有登记表——`list`、`register`、`revoke`、`touch`；每次变更都会刷新运行中的 cookie 校验。设备 id 是带 brand 的不透明值，因此 revoke、touch 与 cookie 签发不会被误传名称或配对码。`touch` 最多每小时推进一次设备的最后可见时间，使普通请求不会反复改写凭据文件；它失败时只被报告，持有 cookie 的手机从不需要等它。配对会话本身受三重约束：32^8 的短码空间、120 秒寿命，以及按来源限流（每 10 秒 10 次读取，连续 5 次失败后锁定 60 秒）；锁定时长从触发限流的那次读取起算，因此锁定会比产生它的十秒计数窗口活得更久。

手机路由只接受一个由生成器字母表组成的八位短码；批准请求的正文采用相同校验。无效短码在渲染或查询状态之前返回 400。启动 JSON 还会转义 `<`：仅用 JSON 字符串引号不能阻止 HTML script 元素被结束标签提前终止。

## 曾考虑的替代方案

- **借 DeepSeek 官方登录。** 否决：dsh 没有可供认证的账号体系——设置里只有 API key 或 provider id，harness 自身的身份是匿名文件 `~/.dsh/.anonymous-user-id`——也没有公开的第三方 OAuth/OIDC 端点可把局域网浏览器委托过去；而登录并不能消除手机到电脑这一段明文窗口。它会给一项本不需要账号的能力加上外部依赖。
- **手机号或短信登录。** 否决：需要短信服务商、用户数据库与找回流程，而本 harness 都没有，且这项部署的合法使用者本来就只有房间里的人。
- **继续用打印出的 URL 作为手机的凭据，二维码里带一份 per-phone secret。** 否决：以同样方式发放的秘密仍然无法按设备吊销，也无法区分持有它的手机。
- **让已配对的手机批准下一台手机，或通过 `/api` 的 Remote 方法批准。** 否决：能接纳设备的设备，等于让"持有局域网地址"就足以加入；而且它会把决定搬到一个手机也能到达的通道上。回环对端与启动令牌 cookie 共同建立本机操作者身份，因此设置面板走与手机相同的 `/pair*` 路由，而不是新增 Remote 孪生方法。
- **设备 cookie 滑动续期。** 否决：被盗的 cookie 只要一直被使用就永远有效。固定寿命加显式吊销，才是操作者能据以推理的东西。登记表窗口在操作者设定时固定，索引请求的刷新只是让 cookie 与该窗口对齐，因此使用仍然不会延长任何东西。

## 后果

- `/pair` 提供应用外壳本身——经由 `frontend-static` 提供的 `frontend` 服务——并携带 `__DSH_PAIR__` 启动事实；手机的配对界面渲染在 `shell.overlay` 之上，cookie 到手后即离开到 `/`，因此手机运行与电脑相同的应用产物。
- 手机接入部署现在有两种凭据形式需要推理：进程启动令牌（只在回环交换，通过删除 `client-connection/browser-session` 吊销）与设备 cookie（任何 authority 上都可签发，通过 `POST /pair/revoke` 按设备吊销）。
- 吊销对运行中的 Host 立即生效，因为每次登记表变更都会刷新内存中的设备集合；损坏到无法解释的设备记录会让操作显式失败，而不是被覆盖。
- 手机到电脑这一段仍是明文 HTTP：网络上的观察者可以读到配对轮询与传输中的设备 cookie，而该 cookie 不带 `Secure` 属性，因为该传输无法兑现它。自签名或 mkcert 证书的 TLS 是单独一期，它才会关上这扇窗并让该属性可以设置。
- `apps/cli/tests/pairing.e2e.ts` 通过真实 CLI 走完整条握手：取码、手机侧未认证界面、仅回环可决定、设备 cookie 让 `/api` 认证通过、已配对手机被拒绝做出决定、吊销让同一 cookie 变成 401，以及按来源锁定。
- 重新加载应用的已吊销手机会看到「需要重新登录」界面，而不是光秃秃的 401：`apps/cli/tests/web-auth.e2e.ts` 通过真实 CLI 断言未认证的局域网 index 请求——无论是否带进程令牌——都以 401 返回携带 `__DSH_AUTH_REQUIRED__` 的外壳且不下发 cookie，而回环上的拒绝保持纯文本响应。
- [LAN Web 服务](../architecture/2026-09-11-lan-web-serving.zh.md)仍是绑定、栅栏与明文 HTTP 警告的权威；本笔记负责"手机是什么、如何被接纳"。[手机接入归入 web profile](../architecture/2026-09-12-phone-access-in-the-web-profile.zh.md)仍是入口归属的权威。
