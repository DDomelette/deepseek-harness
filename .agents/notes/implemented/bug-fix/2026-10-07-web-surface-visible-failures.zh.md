# Agent Note：Web 表面把自己的失败说出来

Status: implemented

[English](2026-10-07-web-surface-visible-failures.md) | 中文

## 问题

五个缺陷让操作者拿不到他需要的事实，而那个事实本来就在界面上。

`GET`/`HEAD` 路由可以声明请求体。桥接层给每个方法都附加 body，而 Fetch 禁止这两种方法带 body，于是 `new Request` 在任何处理器运行之前就抛 `TypeError`；而在产的两个 `GET` 路由声明的正是类型所要求的 buffered 模式。

在配对面板的行内改名里按 Escape 会关掉整个对话框：输入框取消了编辑却没有消费该按键，而 `Modal` 对任何 Escape 都动作，于是丢掉了对话框持有的配对码与二维码。仓库本来就有这条约定——帧抽屉这类更低优先级的 Escape 所有者只对"没有任何界面自行关闭"的 Escape 动作——但模态框没有遵守。

前端从未构建的 checkout 会正常启动、打印 URL，然后对 `/` 返回空 404，而 README 承诺会有构建提示。

重新加载 Web 行的 live patch 会重新绑定服务端却不再次打印它的 URL：宣告按 Context root 去重，而这个 root 在该行自身重载后依然存在。

凭证在页面开着时失效的手机什么都看不到。唯一渲染 `connection.failure.auth` 的界面是侧栏的连接指示器，而 `SettingsRoot` 在手机必然处于的折叠 rail 上把它抑制掉。

## 决定

`ConnectionRequestBodyMode` 新增 `'none'`——不拥有任何带体方法的路由唯一合法的模式；`assertFetchRoute` 在注册时双向拒绝自相矛盾的组合，两个 `GET` 路由声明 `'none'`。桥接层对这种路由上客户端自行框出的 body 以 400 拒绝并关闭连接，而不是让 Fetch 抛出任何处理器都看不到的 `TypeError`。

`Modal` 忽略已经被处理过的 Escape（`defaultPrevented`），配对面板的改名输入则为它取消的那次 Escape 调用 `preventDefault`。因此取消行内编辑会让对话框、配对码与二维码留在原处。

dist 索引缺失时，外壳请求得到 404，其正文点名构建命令；静态资源与普通路由的缺失仍是空 404。

就绪行改为**每次激活**宣告一次，而不是每个 Context root 一次：同一次激活内的 Connection 重载保持安静，而 live patch 重载会打印新激活所绑定服务端的 URL。

「需要重新登录」界面在每一页都注册，并从两个来源之一说明凭证已失效：Host 拒绝文档时携带的 `__DSH_AUTH_REQUIRED__` 启动事实，或连接自身的 `failure` 源报告 `auth`。会话正常时它渲染为 null。

## 考虑过的替代方案

**让 `GET` 路由保留 body 模式，由桥接层剥离 body。** 不采纳：那样该模式什么也不描述，而自相矛盾的声明会留在唯一还能被抓住的地方之外。

**把无体方法上框出的 body 排空。** 不采纳：这种帧本身违反协议，返回 400 让失败可见，胜过静默丢弃这些字节。

**dist 缺失时让启动停止。** 不采纳：页面永不触达静态回退席位的组合本就不带 dist，因此缺失的索引是一个请求期事实；提示应落在响应上，README 现在也这样写。

**按进程去重宣告。** 不采纳：live patch 可能重新绑定到另一个端口，为一个不再服务 GUI 的服务端打印 URL 比重复一行更糟。

**把失败显示在折叠 rail 里。** 不采纳：rail 在手机上只是一条窄带，而 mob 组合包本来就有全屏界面，其文案还点明了电脑端生成新配对码的设置项。

## 后果

Fetch 路由契约写明哪些方法可以携带 body，错误声明的路由在注册时而不是首次请求时失败。一次 Escape 只取消一个界面，由内向外。未构建的 checkout 会告诉操作者该运行什么。被 live patch 的 Web 行会宣告它绑定的服务端。凭证失效的手机会在它正看着的页面上读到原因与补救办法，而无需那个它永远看不到的侧栏。本笔记拥有的五条清单项在[配对待修清单](../../proposed/bug-fix/2026-10-06-phone-access-and-web-surface-defect-backlog.zh.md)中标记为已修。
