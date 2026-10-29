---
description: "dsh 面向 web profile 的局域网手机加入层：设置入口通过一次性短码完成配对，并管理已批准的设备。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-mob

[English](README.md) | 中文

## 概述

启动 `dsh web --host <LAN-IP>`，再打开 设置 → 通用设置 → 连接手机，即可为同一网络中的手机配对：面板申请一次性短码，把 `/pair?c=<code>` 链接渲染成二维码，并对每个请求的手机做出决定。该层在 `web` 表层之上加入这个加入入口与应答它的 `mob` Remote 命名空间；局域网绑定及其警告、操作者令牌交换与签名 cookie 认证仍是 `dsh web` 的行为。监听器支持 HTTP 和配置的 TLS；仅在可信网络上使用明文 HTTP。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 启动局域网表层

```sh
dsh web
dsh web --host 192.168.1.5
dsh web --host 192.168.1.5 --port 8080
```

`web` profile 组合了本组合包。普通 `dsh web` 仅绑定回环地址；同一网络的手机接入时，请像上例一样用 `--host` 指定电脑的具体局域网 IP。`0.0.0.0` 等通配地址会被拒绝。在电脑上打开启动器打印的认证 URL，再打开 设置 → 通用设置 → 连接手机。直接访问绑定 IP 无需重复声明 `--trusted-host`；代理通过 `--public-url` 声明浏览器访问的根 URL，通过 `--trusted-host` 声明主体。启动令牌应保留在电脑上：手机通过配对获得自己的设备 cookie。

### 从桌面会话交接

浏览器半层在 设置 → 通用设置 中加入「连接手机」行，它是唯一的加入入口——终端不打印任何内容。该行打开配对面板：「生成配对码」通过 `POST /pair/session` 向 Host 申请短码，以部署声明的 origin 拼出不带进程令牌的 `/pair?c=<code>` 链接，并把该链接渲染成二维码，旁边显示短码与剩余秒数。随后面板列出待确认的请求——生成的短码只有在手机打开配对页面领取后才会进入列表，因此「允许」永远不会注册一台没有手机持有的设备；每条都带有从手机 agent 推导出的设备名称，可在「允许」或「拒绝」之前修改——以及已配对的设备，每行带有可编辑的名称、批准时从 ARP 表解析到的 MAC 地址（解析得到时）、添加时间、最近一次通过认证的时间，以及一个「吊销凭证」按钮，把设备移入回收站：该设备的下一次请求即失效，而在操作者彻底删除之前，条目仍可恢复。面板先读取仅操作者可访问的设备列表：成功时启用管理操作，禁止访问时说明需要启动器凭据，临时读取失败时提供重试。通过局域网主体认证的操作者可以管理配对，已配对手机则不能。缺少手机访问地址时，`mob/no-advertised-origin` 提示配置具体的 `--host` 或对外声明的 `--public-url`，并且不会创建短码。所有操作都走手机端使用的同一批 `/pair*` 路由，因此守护「决定」的本机操作者认证规则只有一个执行点。决定与设备操作一次只跑一个：在途时落下的第二次点击会被忽略，因此双击不会被上报成失败，而后来的成功会清除失败提示；已决定的请求会立即离开列表。每条已配对设备还会显示寿命：`{days} 天（剩余 {remaining} 天）`、手机仍持有一张较短凭证（下一次请求即续期）时的 `{days} 天（手机凭证剩余 {remaining} 天）`、手机实际持有的凭证已经过期的「凭证已失效，需重新配对」、窗口已过的「已过期」，或旧条目在操作者设定天数之前的 `—`（旧条目仍按 cookie 载荷里的到期时间运行）。该行的「凭证有效期」下拉菜单——`1`/`7`/`30`/`90` 天档位，以及用于任意天数的「自定义…」——会重新开始该设备的倒计时；缩短在手机下一次请求即生效，延长也在手机下一次请求时续期，前提是它当前的 cookie 仍然有效——已经失效的凭证必须重新配对。列表上方的一行文案提示：不再使用或经过不受信任网络的设备请吊销，吊销的设备会留在回收站，可以恢复或彻底删除。

### 配对一台手机

`POST /pair/session` 开启一次请求，并返回一个存活两分钟的 8 位短码。手机打开 `/pair?c=<code>`，该路由提供携带 `__DSH_PAIR__` 启动事实的应用外壳；浏览器半层只在该页面把配对界面注册到 `shell.overlay`，显示短码并每 1.5 秒轮询 `/pair/state`。只有**没有命中活动短码**的读取才计入该来源的限流——界面正在轮询的那次配对不是"搜码"——因此同一台手机上开两个页面不会互相把对方锁在配对流程之外，而被搜码预算锁住的来源仍然可以取走它持有的那个短码的决定。电脑批准的那一刻，这次轮询就会带回设备 cookie，界面随即跳转到 `/`，手机由此拥有自己的会话，而不再依赖电脑的启动令牌；被拒绝、已过期或已被限流的短码会停止轮询，并显示说明下一步该做什么的文案，其中被限流的文案提示等待一分钟，因为在锁定解除前新建短码对该来源没有帮助。`POST /pair/approve` 携带决定与设备名称——批准时还会从 ARP 表解析领取手机的 MAC 地址，这是尽力而为的指纹，解析失败则不记录，手机始终没有取走 cookie 的设备行会在其短码过期后被吊销并彻底删除，因此没有设备领取的批准不会留下任何东西，而登记失败会报告错误并撤回该决定，让操作员可以重新决定，而不是把手机留在一个它永远取不到的决定上——`GET /pair/requests` 列出已被手机领取、仍待决定的请求，`GET /pair/devices` 列出已批准的设备，`POST /pair/devices/label` 为一台设备改名，`POST /pair/revoke` 把某台设备移入回收站——它的下一次请求即失效——`POST /pair/devices/restore` 恢复一台回收站中的设备，`POST /pair/devices/purge` 把回收站中的设备彻底删除。`/pair` 与 `/pair/state` 接受尚无 cookie 的手机——它们仍经过 Host 栅栏，而按来源限流只挂在 `/pair/state` 上——其余每条路由都要求Connection 为该主体接受的有效操作者 cookie，因此局域网上的手机无法自行批准。`POST /pair/devices/lifetime` 携带 `{deviceId, days}`，与吊销、恢复、彻底删除一样属于仅电脑可用的决定路由，因此手机无法延长或缩短自己或他人的窗口；`GET /pair/devices` 会在条目携带时返回该设备的 `lifetimeDays`、`expiresAt`、`credentialExpiresAt`、`macAddress` 与 `revokedAt`，面板的寿命列与回收站据此渲染；旧条目两个窗口字段都不返回。

短码必须恰好包含生成器字母表中的八个字符。`/pair` 与 `/pair/state` 要求查询参数 `c` 恰好出现一次；畸形或重复的短码返回 400。内嵌的启动 JSON 转义 `<`，使短码无法终止其 script 元素。

### 被吊销之后重新接入

设备已被吊销——或 cookie 已过期——的手机到达 Host 时不带任何会话，直到操作者从回收站恢复该设备或让它重新配对。此时 `frontend-static` 以 401 提供携带 `__DSH_AUTH_REQUIRED__` 启动事实的外壳，浏览器半层据此把「需要重新登录」界面注册到 `shell.overlay`：它说明本设备的凭证已过期或被吊销，指出电脑端用哪个设置项生成新配对码，并提供重新加载按钮，用来接上手机在另一个标签页里刚换到的设备 cookie。该界面在 Host 拒绝文档的地方渲染，也会在一个已被接受、但连接报告该凭证失效的页面上立刻出现——手机必然处于的折叠 rail 会隐藏侧栏的连接指示器，因此这里就是它说明原因的地方。持有可用会话的手机不会看到它，而电脑自己的回环页面仍得到 Connection 的 401，提示重新打开打印出的 URL。

### 你会得到什么

`dsh web` 提供的一切，外加「连接手机」入口与其背后的 `mob` Remote 命名空间。Web 服务器、局域网绑定及其明文 HTTP 警告、浏览器信任栅栏与认证仍归 `dsh-host-webserver` 与 `dsh-web-app` 所有；本层不打任何补丁，也不产生终端输出。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本组合包由一份只做插入的 patch 加一个双脸插件组成。patch 加入 `mob-quick-join` 行，以 `webServer` 与 `webStartup` 注入挂载本包的插件，不改动其他任何内容。插件的 apply 挂载两件东西：`MobJoinController`——`mob` Remote 命名空间背后的 Host 服务，其 `joinUrl` 方法为设置弹窗提供服务——以及承载配对握手的十一条 `/pair*` 具名路由。

### 部署声明的 origin

加入根 URL 依次优先使用部署的 `--public-url`、第一个 `--trusted-host` 和具体的非回环监听地址。受信主体保留其显式端口，否则使用绑定端口。监听器提供 HTTP 或 HTTPS 协议，IPv6 字面量使用方括号。回环绑定或带区域标识的非回环绑定在未声明外部主体时以 `mob/no-advertised-origin` 失败。该值不带进程令牌。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | `mob-quick-join` 插入；不针对任何既有行 |
| [`src/index.ts`](src/index.ts) | Host 半层：只挂载 `mob` Remote 命名空间 |
| [`src/join-url.ts`](src/join-url.ts) | Remote 方法调用的共享 URL 拼装器 |
| [`src/controller.ts`](src/controller.ts) | `MobJoinController`：`mob` Remote 命名空间的 `joinUrl`，把未声明 origin 的部署分类为 `mob/no-advertised-origin` |
| [`src/types.ts`](src/types.ts) | `mob` 失败码声明（`mob/no-advertised-origin`），两个 face 共享 |
| [`src/pairing.ts`](src/pairing.ts) | 配对会话：8 位短码、两分钟寿命、每码一次决定，以及只统计"未命中活动短码"读取的按来源限流 |
| [`src/routes.ts`](src/routes.ts) | `/pair*` 具名路由：手机侧的外壳与无 cookie 状态读取，以及经操作者认证的决定 |
| [`src/client/PairScreen.tsx`](src/client/PairScreen.tsx) | 手机端配对界面：启动事实、状态轮询与按决定显示的文案 |
| [`src/client/`](src/client/index.ts) | 浏览器半层：「连接手机」行、配对面板与 `settings.mobile` 字典 |
| [`src/client/PairingPanel.tsx`](src/client/PairingPanel.tsx) | 电脑端配对面板：短码与倒计时、允许/拒绝、设备列表与回收站 |
| [`src/client/pairing-api.ts`](src/client/pairing-api.ts) | 面板调用 `/pair*` 路由的客户端半边，含设备名与配对 URL 两个 helper |
| — | 不发布运行时不变量伴随件；每个可观察效果都在每次调用时从部署声明的 origin 推导（见下文不变量归属）。 |
| [`tests/mob.spec.ts`](tests/mob.spec.ts) | Host 半层：命名空间注册、加入应答、销毁 |
| [`tests/web-profile-composition.spec.ts`](tests/web-profile-composition.spec.ts) | 真实 Loader 组合的 `web` profile：部署声明的 origin 与 `mob/no-advertised-origin` |
| [`tests/join-url.spec.ts`](tests/join-url.spec.ts) | URL 拼装器与 `joinUrl` Remote 方法的局域网/回环两路 |
| [`tests/pairing.spec.ts`](tests/pairing.spec.ts) | 配对会话：短码、批准、过期、单次使用与限流 |
| [`tests/routes.host.spec.ts`](tests/routes.host.spec.ts) | 配对路由：访问规则、短码流程、设备 cookie 与请求体边界 |
| [`tests/pair.client.spec.tsx`](tests/pair.client.spec.tsx) | 配对界面：轮询、批准后跳转与各决定对应的文案 |
| [`tests/panel.client.spec.tsx`](tests/panel.client.spec.tsx) | 配对面板：短码与倒计时、允许/拒绝、设备列表与回收站 |
| [`tests/pairing-api.client.spec.ts`](tests/pairing-api.client.spec.ts) | 配对路由的客户端半边：请求形状、应答解析与 helper |
| [`tests/apply.client.spec.ts`](tests/apply.client.spec.ts) | 行注册、延后槽位声明、注入的 `joinUrl` 与销毁 |
| [`tests/row.client.spec.tsx`](tests/row.client.spec.tsx) | 行与弹窗：加载、二维码渲染、启动提示、关闭与重开 |

### 不变量归属

不发布不变量伴随件，因为插件的可观察效果只有 `mob.joinUrl` 的应答，它在每次调用时从栅栏快照推导，不存在第二个观察者可能与之分叉的缓存状态；Remote 产物接线由 Typert 生成器在构建时校验。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

想深入了解该层所扩展的表层或其背后的安全决策时，阅读这些页面。

- [dsh-web-app](../web-app/README.zh.md)——该层所扩展的浏览器表层。
- [组合包地图](../README.zh.md)——构建在同一核心之上的各个表层。
- [LAN Web 服务笔记](../../../.agents/notes/implemented/architecture/2026-09-11-lan-web-serving.zh.md)——局域网服务的安全决策、启动警告与 cookie 吊销。

-----

<a id="model-experience"></a>
## 模型体验

通过组合的 `dsh-web-app` 各行与会话 preset 间接产生影响，模型可见的注册全部由它们负责；本层的浏览器半层只渲染一个设置入口，完全不触达模型。

#### KV Cache 影响

组合包本身不添加任何请求前缀；缓存影响与 `web` 表层一致。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制告诉你在不可信网络或非常规终端上会遇到什么。它们是当前包约束，不是任务积压。

- **HTTP 会向网络暴露凭据**——请使用可信网络或配置监听器的 TLS 支持；[dsh-web-app](../web-app/README.zh.md) 负责传输与认证配置。
- **局域网明文 HTTP 不是 secure context（安全上下文）**——手机浏览器在明文局域网 HTTP 下没有 `navigator.serviceWorker`，因此 service worker 不会注册、Android 不会出现安装提示；iOS 仍可靠支持通过 `apple-mobile-web-app-capable` 添加到主屏。请配置 HTTPS 以使用需要安全上下文的浏览器功能。
- **iOS 主屏应用没有后台 WebSocket**——iOS 会在应用进入后台时将其挂起，回到前台时由现有 Connection generation 重连与 Remote journal stream 的恢复 cursor 恢复数据流。
- **地址靠配置而非探测**——加入根 URL 使用 `--public-url`、受信主体或具体的非回环绑定地址。网卡扫描不会扩展信任。
- **通配绑定会被拒绝**——`dsh web` 拒绝 `--host 0.0.0.0` 和 `--host ::`，请改用一个接口地址。
- **未声明 origin 的部署不提供加入 URL**——「连接手机」弹窗以 `mob/no-advertised-origin` 失败并指出需要添加的旗标；`dsh-web-app` 的就绪行仍是唯一打印出的 URL。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
