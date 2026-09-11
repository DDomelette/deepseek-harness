---
description: "dsh 的局域网手机加入层：在所有网络接口上提供 Web UI 并打印扫码加入的二维码，供用户向同一网络中的手机开放会话。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-mob

[English](README.md) | 中文

## 概述

运行 `dsh mob` 即可在局域网上提供 dsh Web UI，并打印供手机扫码加入的终端二维码。该层把 Web 服务器重绑到所有网络接口，并在 `web` 表层之上加入二维码播报行；令牌交换与签名 cookie 认证与 `dsh web` 完全一致。服务仍是明文 HTTP，因此只在可信网络上使用。需要手机访问时选择该层；仅本机回环浏览时使用 `dsh web`。

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
dsh mob
dsh mob --port 8080
```

随发行版交付的 `mob` profile 把本组合包叠加在 `dsh-web-app` 之上，因此启动流程与 `dsh web` 相同，只有两处新增：服务器绑定所有网络接口；插件树就位后，终端打印一行携带令牌局域网 URL 的 `dsh mob:` 信息以及可扫描的二维码。同一网络中的手机打开该 URL，完成一次性令牌交换，并获得与回环流程相同的签名 cookie。回环 URL 与浏览器交接仍是 `dsh-web-app` 的就绪输出，在本机上照常可用。

### 从桌面会话交接

组合包的浏览器半层在 设置 → 通用设置 中加入「连接手机」行。该行打开的弹窗通过 `mob.joinUrl` Remote 方法向 Host 请求同一个带令牌的局域网 URL，并将其渲染为二维码、下方附上链接，因此手机加入时无需任何人查看终端。仅回环部署中该调用以 `mob/loopback-only` 失败，弹窗会提示未开启内网访问。

### 你会得到什么

`dsh web` 提供的一切，外加带挂载时 stderr 明文 HTTP 警告的全接口绑定，以及 `mob-quick-join` 二维码播报器。Web 服务器、浏览器信任栅栏与认证仍归 `dsh-host-webserver` 与 `dsh-web-app` 所有；`--port` 等调用旗标通过相同的 `webStartup` 表达式继续生效。其他表层上的命令行 `--host 0.0.0.0` 仍需 `--allow-lan`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本组合包由一份 patch 加一个双脸插件组成。patch 用全接口默认主机重述 `webserver` 行的整个配置——patch 会替换目标行的整个 `config`，因此该行重述它拥有的每个键——并插入 `mob-quick-join` 行，以 `webServer` 与 `webRuntime` 注入挂载本包的插件。插件的 apply 挂载两件东西：终端二维码播报器，以及 `MobJoinController`——`mob` Remote 命名空间背后的 Host 服务，其 `joinUrl` 方法为设置弹窗提供服务。

### 就绪与重印规则

二维码播报器与 `dsh-web-app` 的就绪行一致：等待 Loader 就位（没有 Loader 的手工组建树会立即播报）；启动失败或树在启动中途被拆除时不打印；仅回环绑定或非 TTY stdout 时也不打印。Connection 热重载不得重印，因此已播报的根会在进程范围内被记住。

### 栅栏局域网快照

播报的地址来自 `webRuntime` 服务——即 `dsh-web-app` 喂给 `/api` 信任栅栏的同一份 `resolveLanTrust` 快照——因此扫码 URL 总能通过栅栏。第一个非内部 IPv4 字面量与绑定端口及 Connection 认证令牌一起成为二维码目标；空快照（仅回环）不打印任何内容。播报器与 `mob.joinUrl` Remote 方法经同一个 `resolveJoinUrl` helper 拼装 URL，终端与设置弹窗因此永不分叉。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | `webserver` 行的局域网重绑及 `mob-quick-join` 插入 |
| [`src/index.ts`](src/index.ts) | 二维码播报插件：就位等待、栅栏快照局域网 URL、回环与 TTY 守卫、重印去重、二维码渲染、控制器挂载 |
| [`src/join-url.ts`](src/join-url.ts) | 播报器与 Remote 方法共用的 URL 拼装器 |
| [`src/controller.ts`](src/controller.ts) | `MobJoinController`：`mob` Remote 命名空间的 `joinUrl`，仅回环部署以 `mob/loopback-only` 失败 |
| [`src/types.ts`](src/types.ts) | `mob/loopback-only` 失败码声明，两个 face 共享 |
| [`src/client/`](src/client/index.ts) | 浏览器半层：「连接手机」行、二维码弹窗与 `settings.mobile` 字典 |
| — | 不发布运行时不变量伴随件；每个可观察效果都在每次调用时从栅栏快照推导，已播报根集合是没有独立观察者的私有状态（见下文不变量归属）。 |
| [`tests/mob.spec.ts`](tests/mob.spec.ts) | 就位、回环、TTY、重载去重，以及启动失败/拆除路径 |
| [`tests/composition.spec.ts`](tests/composition.spec.ts) | 真实 Loader 组合：就位门控的加入行与回环静默 |
| [`tests/join-url.spec.ts`](tests/join-url.spec.ts) | URL 拼装器与 `joinUrl` Remote 方法的局域网/回环两路 |
| [`tests/apply.client.spec.ts`](tests/apply.client.spec.ts) | 行注册、延后槽位声明、注入的 `joinUrl` 与销毁 |
| [`tests/row.client.spec.tsx`](tests/row.client.spec.tsx) | 行与弹窗：加载、二维码渲染、回环文案、关闭与重开 |

### 不变量归属

不发布不变量伴随件，因为插件的可观察效果——Loader 就位后的控制台输出与 `mob.joinUrl` 的应答——都在每次调用时从同一份栅栏快照推导，不存在第二个观察者可能与之分叉的缓存状态；已播报根集合是私有的，Remote 产物接线由 Typert 生成器在构建时校验。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

想深入了解该层所扩展的表层或其背后的安全决策时，阅读这些页面。

- [dsh-web-app](../web-app/README.zh.md)——该层重绑并扩展的浏览器表层。
- [组合包地图](../README.zh.md)——构建在同一核心之上的各个表层。
- [LAN Web 服务笔记](../../../.agents/notes/implemented/architecture/2026-09-11-lan-web-serving.zh.md)——局域网服务的安全决策、启动警告与 cookie 吊销。

-----

<a id="model-experience"></a>
## 模型体验

通过组合的 `dsh-web-app` 各行与会话 preset 间接产生影响，模型可见的注册全部由它们负责；二维码播报器只向终端打印。

#### KV Cache 影响

组合包本身不添加任何请求前缀；缓存影响与 `web` 表层一致。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制告诉你在不可信网络或非常规终端上会遇到什么。它们是当前包约束，不是任务积压。

- **局域网服务是明文 HTTP**——网络上任何获得会话 cookie 的人都将获得完全控制权，因此只在可信网络上绑定所有接口；挂载时警告与吊销路径见 [LAN Web 服务笔记](../../../.agents/notes/implemented/architecture/2026-09-11-lan-web-serving.zh.md)。
- **局域网明文 HTTP 不是 secure context（安全上下文）**——手机浏览器在明文局域网 HTTP 下没有 `navigator.serviceWorker`，因此 service worker 不会注册、Android 不会出现安装提示；iOS 仍可靠支持通过 `apple-mobile-web-app-capable` 添加到主屏。完整的安装体验留待后续 TLS 工作。
- **局域网地址只在启动时采样一次**——启动后的网络变化不会重新播报；重启表层即可重新通告。
- **仅回环绑定与非 TTY stdout 不打印二维码**——监管进程与回环部署不会得到播报；`dsh-web-app` 的 URL 行仍是就绪信号。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
