---
description: "dsh 面向 web profile 的局域网手机加入层：设置入口把带令牌的局域网 URL 渲染成二维码，供同一网络中的手机扫码加入。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-mob

[English](README.md) | 中文

## 概述

启动 `dsh web --host 0.0.0.0 --allow-lan`，再打开 设置 → 通用设置 → 连接手机，即可显示供同一网络中的手机扫码加入的二维码。该层在 `web` 表层之上加入这个加入入口与应答它的 `mob` Remote 命名空间；局域网绑定及其警告、令牌交换与签名 cookie 认证仍是 `dsh web` 的行为。服务仍是明文 HTTP，因此只在可信网络上使用。

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
dsh web --host 0.0.0.0 --allow-lan
dsh web --host 0.0.0.0 --allow-lan --port 8080
```

`web` profile 组合了本组合包，因此手机接入就是 `dsh web` 的普通能力：就绪行在回环 URL 旁打印带认证的局域网 URL，同一网络中的手机打开它，完成一次性令牌交换，并获得与回环流程相同的签名 cookie。`--allow-lan` 是在可信网络提供服务所需的显式确认；没有它，全接口绑定仍是用法错误。

### 从桌面会话交接

浏览器半层在 设置 → 通用设置 中加入「连接手机」行，它是唯一的加入入口——终端不打印任何内容。该行打开的弹窗通过 `mob.joinUrl` Remote 方法向 Host 请求带令牌的局域网 URL，并将其渲染为二维码、下方附上链接。仅回环部署中该调用以 `mob/loopback-only` 失败，弹窗提示未开启内网访问；而当 all-interfaces 绑定推导不出可达地址时以 `mob/no-lan-address` 失败，弹窗改为提示检查本机网络——那种情况下加旗标并无帮助。

### 配对一台手机

`POST /pair/session` 开启一次请求，并返回一个存活两分钟的 8 位短码。手机打开 `/pair?c=<code>` 并轮询 `/pair/state`；电脑批准该请求的那一刻，这次轮询就会带回设备 cookie，手机由此拥有自己的会话，而不再依赖电脑的启动令牌。`POST /pair/approve` 携带决定与设备名称，`GET /pair/requests` 列出仍待决定的请求，`GET /pair/devices` 列出已批准的设备，`POST /pair/revoke` 让某台设备的下一次请求失效。`/pair` 与 `/pair/state` 接受尚无 cookie 的手机——它们仍经过 Host 栅栏与按来源限流——其余每条路由都要求浏览器会话**且**来自回环 authority，因此局域网上的手机无法自行批准。

### 你会得到什么

`dsh web` 提供的一切，外加「连接手机」入口与其背后的 `mob` Remote 命名空间。Web 服务器、局域网绑定及其明文 HTTP 警告、浏览器信任栅栏与认证仍归 `dsh-host-webserver` 与 `dsh-web-app` 所有；本层不打任何补丁，也不产生终端输出。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本组合包由一份只做插入的 patch 加一个双脸插件组成。patch 加入 `mob-quick-join` 行，以 `webServer` 与 `webRuntime` 注入挂载本包的插件，不改动其他任何内容。插件的 apply 挂载两件东西：`MobJoinController`——`mob` Remote 命名空间背后的 Host 服务，其 `joinUrl` 方法为设置弹窗提供服务——以及承载配对握手的七条 `/pair*` 具名路由。

### 栅栏局域网快照

加入 URL 来自 `webRuntime` 服务——即 `dsh-web-app` 喂给 `/api` 信任栅栏的同一份 `resolveLanTrust` 快照——因此扫码 URL 总能通过栅栏。第一个非内部 IPv4 字面量与绑定端口及 Connection 认证令牌一起成为二维码目标；空快照（仅回环）会让该调用失败，而不是给出 URL。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | `mob-quick-join` 插入；不针对任何既有行 |
| [`src/index.ts`](src/index.ts) | Host 半层：只挂载 `mob` Remote 命名空间 |
| [`src/join-url.ts`](src/join-url.ts) | Remote 方法调用的共享 URL 拼装器 |
| [`src/controller.ts`](src/controller.ts) | `MobJoinController`：`mob` Remote 命名空间的 `joinUrl`，把空快照分类为 `mob/loopback-only` 或 `mob/no-lan-address` |
| [`src/types.ts`](src/types.ts) | `mob` 失败码声明（`mob/loopback-only`、`mob/no-lan-address`），两个 face 共享 |
| [`src/pairing.ts`](src/pairing.ts) | 配对会话：8 位短码、两分钟寿命、每码一次决定与按来源限流 |
| [`src/routes.ts`](src/routes.ts) | `/pair*` 具名路由：手机侧两条无 cookie 步骤与电脑侧仅回环可用的决定 |
| [`src/client/`](src/client/index.ts) | 浏览器半层：「连接手机」行、二维码弹窗与 `settings.mobile` 字典 |
| — | 不发布运行时不变量伴随件；每个可观察效果都在每次调用时从栅栏快照推导（见下文不变量归属）。 |
| [`tests/mob.spec.ts`](tests/mob.spec.ts) | Host 半层：命名空间注册、加入应答、销毁 |
| [`tests/web-profile-composition.spec.ts`](tests/web-profile-composition.spec.ts) | 真实 Loader 组合的 `web` profile：局域网 URL、`mob/loopback-only` 与 `mob/no-lan-address` |
| [`tests/join-url.spec.ts`](tests/join-url.spec.ts) | URL 拼装器与 `joinUrl` Remote 方法的局域网/回环两路 |
| [`tests/pairing.spec.ts`](tests/pairing.spec.ts) | 配对会话：短码、批准、过期、单次使用与限流 |
| [`tests/routes.host.spec.ts`](tests/routes.host.spec.ts) | 配对路由：访问规则、短码流程、设备 cookie 与请求体边界 |
| [`tests/apply.client.spec.ts`](tests/apply.client.spec.ts) | 行注册、延后槽位声明、注入的 `joinUrl` 与销毁 |
| [`tests/row.client.spec.tsx`](tests/row.client.spec.tsx) | 行与弹窗：加载、二维码渲染、回环文案、关闭与重开 |

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

- **局域网服务是明文 HTTP**——网络上任何获得会话 cookie 的人都将获得完全控制权，因此只在可信网络上绑定所有接口；启动警告与吊销路径见 [LAN Web 服务笔记](../../../.agents/notes/implemented/architecture/2026-09-11-lan-web-serving.zh.md)。
- **局域网明文 HTTP 不是 secure context（安全上下文）**——手机浏览器在明文局域网 HTTP 下没有 `navigator.serviceWorker`，因此 service worker 不会注册、Android 不会出现安装提示；iOS 仍可靠支持通过 `apple-mobile-web-app-capable` 添加到主屏。完整的安装体验留待后续 TLS 工作。
- **iOS 主屏应用没有后台 WebSocket**——iOS 会在应用进入后台时将其挂起，回到前台时由现有 Connection generation 重连与 Remote journal stream 的恢复 cursor 恢复数据流。
- **局域网地址只在启动时采样一次**——启动后的网络变化不会反映到加入 URL 中；重启 `dsh web` 即可重新采样网络。
- **虚拟网卡排在物理网卡之后**——VPN/代理的虚拟网卡（Clash TUN、VMware host-only 网卡、WSL、Docker 网桥）按接口名识别并自动排后，198.18.0.0/15 fake-ip 段与 169.254.0.0/16 链路本地段直接排除；就绪行会打印其余候选地址，若二维码地址仍不对，用 `ipconfig`/`ip addr` 查真实局域网 IP，替换 URL 中的主机部分即可。
- **仅回环绑定不提供加入 URL**——「连接手机」弹窗以 `mob/loopback-only` 失败并指出需要添加的旗标；`dsh-web-app` 的就绪行仍是唯一打印出的 URL。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
