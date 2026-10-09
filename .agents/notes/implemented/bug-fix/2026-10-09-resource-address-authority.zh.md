# Agent Note：资源协议键从地址文本读取

Status: implemented

[English](2026-10-09-resource-address-authority.md) | 中文

## 问题

`protocolOf(address)` 用 `new URL(address).hostname` 决定资源地址的协议。经配对流程访问 `dsh web` 局域网部署的手机 WebView，对 `dsh-resource://file/…` 报告空 `hostname`，并把 authority 留在 `pathname` 里；于是每个 `file` 地址看起来都是"没有协议的地址"：已注册的 `file` 提供者对持有者不可达，`useResource<'file'>` 的答案恒为 `none`，而只在协议有提供者时才读取文件的右侧 Sidebar 预览，对每个文件都显示"文件资源服务不可用。"，同时聊天、工具卡片与文件树照常工作。同一个会话、同一个文件在桌面浏览器里正常渲染，因为那里的 URL 解析器把 `file` 报告为 host。

在出错页面内渲染的探针钉住了出错的那一步：`urlHost=(empty)`、`meta=none`、`sameRegistry=true`、`wfRegistered=true`。提供者确实注册在 hook 读取的那个注册表里、插件也确实 apply 过；缺的只是协议键。在桌面浏览器里复现同一套引擎行为可以精确重现该故障，下面的修复消除了它。

## 决定

`protocolOf` 从地址文本里读 authority：要求大小写不敏感的 `dsh-resource://` 前缀，取到第一个 `/`、`?` 或 `#` 之前为止，返回小写形式；没有 authority、或地址不是资源地址时返回 `undefined`。`new URL` 不再参与，因此"地址是否命名了协议"不再由任何引擎的解析器决定。

客户端代码不得用 `new URL` 读取 `dsh-resource://` 地址。URL 规范把非特殊 scheme 的 authority 留给实现，而实现之间并不一致，资源模型的键不能随之漂移。[`packages/client/resources`](../../../../packages/client/resources/README.zh.md) 拥有该语法；[客户端资源模型](../architecture/2026-09-05-client-resource-model.zh.md)记录这个键所属的模型。

## 考虑过的替代方案

**保留 `new URL`，在浏览器兜底层里修 `URL`。** 不采纳：[`installBrowserCompat`](../../../../packages/client/web/src/compat.ts) 是给引擎缺失的 API 铺设的底座，改写一个全局构造器会同时改变所有 bundle 的行为，也会波及资源模型并不拥有的自定义 scheme 字符串。

**用 `file` 语法（`parseFileAddress`）解析地址。** 不采纳：该语法是 `file` 专用的，而 `protocolOf` 是 `ResourceProtocolMap` 每一项共用的协议通用键；让一个协议的解析器来定义它，会让下一个协议的地址成为特例。

**去掉文档预览里"提供者必须在"的闸门，让它照读。** 不采纳：那道闸门正是判断"文件服务是否存在"的地方，而其它每个 `useResource` 消费方读到的仍然是 `none`；预览会变成唯一一个分不清"服务缺失"和"文件缺失"的界面。

**把没有 host 的地址也当作资源。** 不采纳：`sidebar://guide` 这类导航地址必须保持非资源，Sidebar 的 tab 注册表依赖这两族永不混用。

## 后果

协议键不再依赖解析器的规范化：authority 原样取用并转小写，因此带有 userinfo 或百分号转义的地址会得到一个解析器本会规范化成别的结果。本代码自行拼装的地址不会这样；`packages/client/resources` 同时钉住了与解析器无关的既有用例（其它 scheme、裸路径、空 authority）和一个被替换成"自定义 scheme 的 `hostname` 为空"的 `URL`——后者对 `dsh-resource://file/session/s1/a.txt` 仍必须得到 `file`。

引擎差异仍会触及那些用 `new URL` 从地址里取*路径*的地方：Sidebar 的纯路径 glob（`ui-sidebar-right` 的 `pathOf`）在这类引擎上看到的是 `//file/session/…`。`basename` 匹配让所有已发布的 pattern 照常工作，而以后新增的路径形 pattern 不能假定解析器的答案。[浏览器兜底层](2026-09-12-browser-floor-for-the-web-shell.zh.md)负责引擎缺失的 API；本笔记负责答案不同的 API。
