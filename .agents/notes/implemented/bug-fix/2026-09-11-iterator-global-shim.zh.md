# Agent Note: 为 ES2025 之前的浏览器提供 pdfjs-dist 的 Iterator 全局 shim

Status: implemented

[English](2026-09-11-iterator-global-shim.md) | 中文

## 问题

文档预览侧栏内联了 pdfjs-dist，后者在导入期通过对 `Iterator` 全局的裸引用来 polyfill `Iterator.prototype.join`（pdf.mjs）。没有 ES2025 Iterator 全局的浏览器（Safari < 18.4、Chrome < 117）在该引用处抛 ReferenceError；由于失败发生在 Client 加载插件树期间，整个 Web UI 在这些浏览器上白屏——而手机浏览器正是 `mob` profile 的目标用户。携带该全局的新版 PC 浏览器不受影响。

## 决策

Web 入口（`apps/web/src/main.ts`）在插件树加载前安装最小 shim：当 `globalThis.Iterator` 不存在时定义它，并把 `prototype` 指向内禀的 %IteratorPrototype%——即生成器迭代器本就继承的对象——在运行时经 `Object.getPrototypeOf` 沿生成器原型链取得。pdfjs 写入的 polyfill 于是落在其调用点（生成器可迭代对象上的 `.join(sep)`）能触及的位置。

## 曾考虑的替代方案

- **携带完整的 Iterator Helpers polyfill（core-js）。** 否决：全部面只为一个导入点的一个方法（`join`）服务；core-js 的模块图让每一个浏览器都为这一个 shim 付出真实字节。
- **给 pdfjs-dist 的打包产物打补丁。** 否决：裸引用是上游代码；对打包产物维护补丁会在每次 pdfjs 升级时重新失效。
- **要求支持 Iterator 的浏览器。** 否决：这把本就可用的浏览器范围变窄，且失败形态（白屏）不给用户任何可操作的信号。

## 后果

- ES2025 之前的浏览器重新能启动 Web UI；shim 在任何插件导入之前运行，在当代浏览器上零成本（守卫跳过）。
- shim 只覆盖 pdfjs 的 `Iterator.prototype.join` 用法；那些浏览器上未来出现其他 Iterator Helpers 用法（`map`、`filter` 等）时需要真正的 polyfill。
- shim 归入口所有；后续新增裸引用 `Iterator` 的依赖只在 `join` 式原型写入这一范围内继承该覆盖。
