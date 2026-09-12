# Agent Note: Web 安装元数据与静态资源 service worker

Status: implemented

[English](2026-09-12-web-install-metadata-and-service-worker.md) | 中文

## 问题

已安装的 Web 版本需要文档本身不携带的元数据，而浏览器是否据此行动取决于应用无法设定的条件：service worker 与安装提示都要求 secure context（安全上下文）。`localhost` 与 HTTPS 满足该条件；`mob` profile 以明文 HTTP 在 `http://<LAN-IP>:3080` 提供同一份构建产物，因此那里的手机浏览器没有 `navigator.serviceWorker`、也不会得到安装提示，只有 iOS 自身的元数据还能给这台手机一个全屏的主屏启动。manifest（元数据清单）只列出一个 SVG 图标且没有配色，因此安装后的启动没有自己的图标、安装后的浏览器界面也不声明配色；同时没有 worker 持有静态资源，所以每次访问都要重新下载 bundle、样式、字体与图标。

## 决策

`apps/web/public/manifest.webmanifest` 把 `id`、`start_url` 与 `scope` 固定为 `/`，以短名称 `DSH` 命名产品 `DeepSeek Harness`，请求 `display: "fullscreen"`，声明取值为 `#151517` 的 `theme_color` 与 `background_color`，并把 `/icon-192.png`、`/icon-512.png` 与 `/favicon.svg` 列为图标。`#151517` 是启动页深色主题下的 `--dsh-boot-bg`，用于启动闪屏背景与安装后的浏览器界面；manifest 是静态文件，不跟随运行中 shell 解析出的浅色或深色调色板，所以浅色主题的安装仍显示该颜色。

`apps/web/scripts/gen-icons.mjs` 以 density 384 把 `apps/web/public/favicon.svg` 光栅化为两张 PNG 与 180px 的 `apple-touch-icon.png`；`sharp` 是 `apps/web` 的 devDependency，三张 PNG 提交进仓库，`pnpm -C apps/web run gen-icons` 可重新生成全部三张。

`apps/web/index.html` 携带 manifest 链接、与该颜色一致的 `theme-color`、`mobile-web-app-capable` 与 `apple-mobile-web-app-capable` 能力标签、取值为 `black-translucent` 的 `apple-mobile-web-app-status-bar-style`，以及指向 `/apple-touch-icon.png` 的 `apple-touch-icon` 链接。iOS 从该链接而非 manifest 的图标列表取主屏图标，并在没有 secure context 的情况下同样遵循这些能力标签。

`apps/web/public/sw.js` 是手写 worker，只承载一条策略，缓存名为 `dsh-static-v1`。它的 `fetch` 处理器在请求不是 GET、带有 `mode === 'navigate'`、或路径以 `/api` 开头时直接返回而不调用 `respondWith`；其余请求——按内容哈希命名的 bundle 资源、样式、字体与图标——一律以 stale-while-revalidate 应答：缓存命中时以缓存响应作答，同时照常发起网络请求，并在 `response.ok` 成立时把响应存回同一个键。实时传输是通往 `/api/remote.mux` 的 WebSocket：WebSocket upgrade 不是 fetch 请求，处理器根本看不到它，而 `/api` 这条守卫无论如何都覆盖该 URL。`install` 调用 `self.skipWaiting()`，`activate` 调用 `event.waitUntil(self.clients.claim())`，因此已安装的 worker 会替换前一个，并在无需等待重新加载的情况下接管已打开的页面。`apps/web/tests/sw-cache-policy.spec.ts` 在伪造的 worker 全局环境中执行该源文件，并固定该策略的每个分支。

`apps/web/src/main.ts` 在 `'serviceWorker' in navigator` 成立时，于页面的 `load` 事件中注册 `/sw.js`，并忽略注册失败。

## 曾考虑的替代方案

- **`vite-plugin-pwa` 或 workbox。** 否决：该策略只有一个缓存名与一条 fetch 谓词，作用于本仓库自带静态回退所服务的文件，因此这两个工具都会用一个生成器产出的 worker、precache manifest 与构建配置，替换一个 26 行、经人审阅的文件，而策略本身并不需要它们。
- **连 `/api` 响应一起缓存。** 否决：`/api` 面是已认证的，承载以 Host 会话日志为权威的实时会话状态；缓存响应会提供已被取代的会话，并把已认证数据的失效处理移进一个观察不到该日志的 worker。
- **只保留 manifest 元数据、不引入 worker。** 否决：`mob` profile 存在的意义就是让手机成为一等客户端，而 touch icon 与重复访问缓存正是该手机每次启动都要用到的东西。
- **预缓存 shell，让应用可离线打开。** 否决：会话、工作区与实时流都来自 Host，离线 shell 只会呈现一个无法显示会话的客户端；因此导航始终走网络，worker 不承诺离线应用。

## 后果

- 在 `localhost` 与 HTTPS 下 worker 会注册，重复访问时静态资源由缓存作答并在后台重新校验；导航永不来自缓存，因此没有离线启动。
- 在明文 HTTP 局域网访问（`dsh mob`）下不会注册 worker、也不会出现安装提示；iOS 仍可通过能力标签与 touch icon 把页面添加到主屏。
- iOS 主屏启动没有后台 WebSocket：应用离开前台会挂起多路复用 socket，回到前台时由现有 Connection generation 重连与 Remote journal stream 的恢复 cursor 恢复。
- 固定 URL 下的文件——图标、`favicon.svg` 与 `manifest.webmanifest`——在变更后的第一次请求由缓存作答，且只在后台刷新，因此那一次请求可能渲染变更前的字节。Vite 按内容哈希命名 bundle 资源，变更后的 bundle 拥有新 URL，绝不会提供被取代的条目。
- 没有任何淘汰：每个哈希资源 URL 与每个固定 URL 都会新增一个条目，`caches.delete` 从未被调用；后续策略若重命名缓存，`dsh-static-v1` 会一直留存到浏览器自行淘汰为止。
- 静态回退的 MIME 表显式列出 `.js` 与 `.webmanifest`，但没有 `.png` 条目，因此图标响应携带 `application/octet-stream`。
- 本笔记在它重新开启的三个问题上取代了[已归档的安装元数据笔记](../../archived/feature/2026-08-06-web-install-manifest.md)——service worker、静态主题色与背景色，以及位图图标——并重述仍然随产品交付的身份、根作用域、显示模式与 `lang` 省略。该归档三件套保持冻结，永不编辑。
