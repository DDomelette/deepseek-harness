# Agent Note：注册按身份释放，未构建的 dist 是每个 index 界面各自应答的缺失

Status: implemented

[English](2026-10-07-webserver-registration-identity-and-index-miss.md) | 中文

## 问题

webserver 的三张注册表都按 key 释放条目：`register` 与 `registerUpgrade` 按路径删除，`registerFallback` 则无条件清空席位。因此，在所有者已被替换之后才运行的 disposer 会移除当时占据该路径——或该席位——的那一个，也就是运行中的服务器上一条生效路由凭空消失。

修第一项时又暴露出兜底席位的第二个问题。Cordis 的服务方法以框架通过调用方 Context 解析出的 `this` 运行，因此在 disposer 里读取 `this.fallback` 时，它面对的是一个到 disposer 被调用时早已被销毁的 Context；比较于是读到 `undefined`，席位永远不会被释放。相比之下，注册时的写入能到达服务实例，于是那个过期的席位一直占着，后来的所有者无法注册。

兜底席位返回的 405 不指明任何方法，客户端只能猜哪种请求可行。MIME 表缺少 `.woff2`、`.woff`、`.ttf` 与 `.png`——即实际交付的 dist 里就有的图标字体与图片——浏览器收到的是 `application/octet-stream`。

dist 没有 `index.html` 时，`FrontendService.renderIndex()` 会抛错。兜底席位接住了它并回答指出 `pnpm run build` 的可操作 404，但配对界面（`/pair`）等待的是同一个方法：它的抛错逃出路由处理器，落进 webserver 最后一道兜底守卫，得到 400——对着未构建检出扫短码的手机读到的是"请求错误"，而不是"本 Host 不提供应用外壳"。

## 决定

每个注册只有在它仍是当前注册值时才释放自己：路由表拿 disposer 当初对应的那条 route 与表内存储值比较；兜底席位把 handler 放在一个单键持有对象里，由注册捕获该对象。正是这个持有对象让比较与 `this` 无关，因为闭包保留的是对象本身，而不是通过可能已消失的 Context 去读字段。

兜底返回 `405` 时带 `Allow: GET, HEAD`，即该席位所服务的方法。

MIME 表补上交付 dist 实际携带的四种扩展名：字体按 `font/woff2`、`font/woff`、`font/ttf` 提供，图片按 `image/png` 提供。

dist 中没有可读的 `index.html` 时，`FrontendService.renderIndex()` 返回 `undefined`，其他读取失败仍然抛出。兜底席位对 `undefined` 回答与原先相同的 404 加构建提示，配对界面对它回答已有的 503，于是两个 index 界面都在各自的响应里说明同一个原因。

## 考虑过的替代方案

**继续按 key 删除，接受替换竞态。** 不采纳：迟到的 disposer 静默撤掉一条生效路由，是没有任何可见原因的服务失败，而身份比较只多一次读取。

**保留 `this.fallback`，用原始服务实例做判断。** 不采纳：拿到原始实例意味着依赖 Cordis traceable 代理的内部细节；注册时捕获的持有对象只用到已公开的行为。

**dist index 缺失与普通缺失一样返回空 404。** 不采纳：就绪行已经打印过 URL，操作者需要知道产出外壳的那一步；配对路由也为同一种缺失保留自己的 503。

**让 `renderIndex()` 自己写响应。** 不采纳：配对路由要向返回的字节里注入自己的启动事实，因此该方法返回外壳，而不是拥有响应。

**用不可读文件覆盖 dist index 读取失败。** 不采纳：在 Windows 与 Linux 上都没有可移植的夹具能产生权限失败；规范改为让 Node 拒绝读取一个配置路径来触达该分支。

## 后果

注册的生命周期长于任何不属于它的 disposer，包括对已运行过的 disposer 的第二次调用。已释放的席位保持释放，替换的所有者可以认领。探测外壳的客户端能知道该席位回应哪些方法。字体与图片按类型送达浏览器，而不是变成不透明的下载。dist 未构建的检出在 `/` 上报出构建步骤，在配对界面上报出"不提供应用外壳"，而真正的 index 读取失败仍然大声失败。本笔记拥有的清单项已在[配对待修清单](../../proposed/bug-fix/2026-10-06-phone-access-and-web-surface-defect-backlog.zh.md)中标记为已修。
