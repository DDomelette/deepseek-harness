# Agent Note: Web shell 的浏览器底座

Status: implemented

[English](2026-09-12-browser-floor-for-the-web-shell.md) | 中文

## 问题

`dsh mob` 通过明文 HTTP 把 Web shell 提供给操作者手机上现成的引擎，而手机 WebView 极少获得更新。若干已发布的 client bundle 调用了比这些引擎更新的标准 API：API gateway 的 generation 路径、workspace 与 deliverables UI 用了 `AbortSignal.any`（Chrome 116、Safari 17.4）；approval、user-question、workspace-files、dynamic-runner 等 bundle 用了 `Promise.withResolvers`（Chrome 119、Safari 17.4）；pdfjs-dist 在导入期引用 ES2025 的 `Iterator` 全局（Chrome 117、Safari 18.4）。

在 Chrome 114 的 Android 浏览器上，失败是静默而彻底的：mux WebSocket 完成 upgrade 后一秒内断开，因为 gateway 的流读取抛 `TypeError: AbortSignal.any is not a function`。客户端此后按退避无限重连，于是外壳照常渲染，而会话、工作区与消息永远不出现。认证、cookie 绑定、Host 栅栏与 LAN 通路都不受影响——抓到的每一条 `/api` 响应都是 200。

## 决策

`packages/client/web/src/compat.ts` 拥有这层浏览器底座，`AppWebEntry.run()` 把安装它作为第一步，先于任何 bundle 导入：`AbortSignal.any`（以最先中止的来源作为融合信号的中止原因，并在融合信号中止后释放来源上的监听器）、[为 ES2025 之前的浏览器提供 pdfjs-dist 的 Iterator 全局 shim](2026-09-11-iterator-global-shim.zh.md) 所述的 `Iterator` 载体，以及 `Promise.withResolvers`。引擎已提供某个 API 时，对应定义被跳过。

有两个脚本先于 shell 运行，因此各自构造原语而不调用底座：Host 注入的启动就绪尾脚本（`packages/host/webserver/src/injections.ts`）与 worker 预览引导（`packages/experimental/webworker-runtime/src/client/index.ts`）都用 `new Promise` 构造其 deferred。

## 曾考虑的替代方案

- **逐个改写调用点以避开该 API。** 否决：`AbortSignal.any` 是融合信号的正确方式，逐点手写等于用五个包的改动换取三十行底座，而且 bundle 携带的第三方浏览器代码（pdfjs-dist、React 及其他打包输入）依旧没有覆盖。
- **携带 polyfill 库（core-js）。** 与 Iterator shim 同理否决：为了让每个浏览器覆盖三个 API，却要所有浏览器付出整个库的代价。
- **声明最低浏览器版本。** 否决：部署目标就是操作者手里现成的手机，而失败形态不给任何可操作信号——外壳看起来是活的，数据却不来。

## 后果

- 比底座中最新的 API 更老的引擎能启动可用的应用；当代引擎跳过每一条定义，因此在那里零成本。
- 底座只覆盖当前已发布 bundle 调用的这三个 API。若某个 bundle 又用了同类新 API（`Object.groupBy`、`Array.fromAsync`、`Set.prototype.union` 等），需要在此补上定义，而目前没有任何机制自动发现这种遗漏。
- `Iterator` 的覆盖仍限于 `join` 式原型写入；以方法形式调用的 iterator helpers（`Iterator.from`）仍需要真正的 polyfill。
- `apps/web/tests/legacy-engine.e2e.ts` 在浏览器里删除这些 API、启动构建产物，并断言 mux 确实在传输帧；因此底座若不再覆盖某个 bundle，失败的是测试而不是手机。
