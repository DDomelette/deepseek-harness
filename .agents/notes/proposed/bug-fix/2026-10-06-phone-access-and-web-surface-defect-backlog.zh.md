# Agent Note: 手机接入与 Web 表层缺陷待修清单

Status: proposed

[English](2026-10-06-phone-access-and-web-surface-defect-backlog.md) | 中文

## 问题

一台已配对手机失去访问权时，「连接手机」面板仍在报告 `90 天（剩余 87 天）`。设备 cookie 在签发的那一刻就冻结了自己的到期时间，因此操作者延长的窗口只有在手机当前凭证仍然有效时、经由一次请求才能送达；一旦凭证先失效，面板继续宣传那个窗口，而那台手机只能重新配对。修好这一条暴露出它周边的整个表层：对 `packages/bundle/mob`、`packages/client/connection`、`packages/host/frontend-static`、`packages/host/webserver`、`packages/bundle/web-app` 与 `packages/client/ui-primitives` 的只读审计找到三十项可从代码复现的缺陷，其中若干项直接违反仓库自己已经写明的不变量。把它们记在这里，是因为每一项都可独立修复，也因为其中三项——被取消的流式下载会永久挂起、大小写别名的索引路径跳过浏览器认证、VirtualBox host-only 地址会赢下配对二维码——在 `dsh web` 实际发布的平台上都可达。

## 提案

按爆炸半径从小到大分三批修。先修第一梯队：每一项要么泄漏资源、要么击穿已写明的不变量、要么直接弄坏手机接入流程。第一梯队与第二梯队已完成；已修的条目会点名拥有其决策的笔记。

### 第一梯队 — 资源泄漏、认证不变量与手机接入流程

| 项 | 证据 | 修法 |
|---|---|---|
| 被取消的流式响应让 `bridge()` 永久挂起，且从不取消响应体流 | `packages/client/connection/src/http-bridge.ts:97-107` 只等 `'drain'`/`'close'`，而 `'close'` 只触发一次；对真实 `bridge` 复现：12.8 MiB 队列流、客户端收到首块后断开 → 6 秒后仍 pending、`cancel()` 从未调用，而同一条响应在读完时 104 ms 就 resolved | 不再等一次性事件：检查 `res.destroyed`/`writableEnded`，并在拆解时 `cancel()` 响应体 —— **已修**于[桥接笔记](../../implemented/bug-fix/2026-10-06-http-bridge-settles-on-client-disconnect.zh.md) |
| 大小写别名的索引路径（`/INDEX.html`）跳过 `authorizeIndex`，Host/Origin 栅栏与浏览器认证都不执行 | `packages/host/frontend-static/src/index.ts:130` 用大小写敏感的字符串比较，而 `readFile` 在 NTFS/APFS 上按大小写不敏感解析 | 比较规范化后的真实路径（`realpathSync.native`），或对任何「大小写不敏感地等于索引路径」的请求 fail closed —— **已修**于[索引入口笔记](../../implemented/bug-fix/2026-10-06-index-entry-resolved-identity.zh.md) |
| VirtualBox host-only 地址可能成为配对二维码的 authority | `packages/bundle/web-app/src/index.ts:123` 的模式漏了 `virtualbox`/`vbox`（以及 macOS Docker 的 `bridge100`），而它的 JSDoc 声称覆盖；`packages/bundle/mob/src/join-url.ts:17` 只用 `lanAddresses[0]` 拼二维码 | 扩充虚拟网卡模式，并用一条推导测试固定 —— **已修**于[虚拟网卡笔记](../../implemented/bug-fix/2026-10-06-virtual-adapter-derivation-covers-virtualbox.zh.md) |
| 已批准、但手机从未取走 cookie 的设备行会一直是活跃行且无回收路径 | `packages/bundle/mob/src/routes.ts:315-327` 只在 `bindDevice` 失败时回滚，而 `packages/bundle/mob/src/pairing.ts:178-181` 删除过期会话时不触碰设备行；该不变量固定在 `packages/bundle/mob/tests/routes.host.spec.ts:358-364` | 会话过期时，对从未被领取的设备行执行吊销并彻底删除 —— **已修**于[回收笔记](../../implemented/bug-fix/2026-10-06-reclaim-uncollected-device-registrations.zh.md) |
| 配对端到端用例自回收站上线起一直失败 | `apps/cli/tests/pairing.e2e.ts:314` 期望吊销后 `devices: []`，而该路由按设计列出回收站条目；三次运行全部在该行失败 | 改为断言那条已入回收站的行，而不是空列表 —— **已修**，与回收笔记同一改动 |
| 带请求体的 `GET`/`HEAD` 路由在处理器运行前就抛 `TypeError` | `packages/client/connection/src/http-bridge.ts:68-81` 对任何方法都挂 body，而 Fetch 禁止 `GET`/`HEAD` 带 body；`ConnectionFetchMethod` 与 `assertFetchRoute` 却接受该组合 | 只对允许带 body 的方法挂 body，并在注册期拒绝该组合——**已修**，见 [Web 表面笔记](../../implemented/bug-fix/2026-10-07-web-surface-visible-failures.zh.md) |
| 就绪行与开浏览器发生在会中止启动的激活审计之前 | `packages/bundle/web-app/src/index.ts:334-345` 在 Loader 结算时公告，而永久 pending 的 fiber 也会结算（`vendor/loader/src/config/tree.ts:46-64`），审计在其后（`packages/boot/app-boot/src/index.ts:812-814`） | 只在启动真正完成后公告，走现成的 `appReady` —— **已修**于[就绪笔记](../../implemented/bug-fix/2026-10-06-readiness-follows-committed-startup.zh.md) |

### 第二梯队 — 用户可见行为

- 凭证在页面开着时失效的手机看不到任何原因：唯一渲染 `connection.failure.auth` 的界面是侧栏指示器，而 `packages/client/ui-settings-general/src/client/SettingsRoot.tsx:235` 在手机必然处于的折叠 rail 上把它抑制掉——**已修**，见 [Web 表面笔记](../../implemented/bug-fix/2026-10-07-web-surface-visible-failures.zh.md)。
- 同一台手机开两个配对页面就会超过「每十秒十次」的预算，把该来源锁一分钟，而界面让操作者去生成一个在锁过期前毫无用处的短码（`packages/bundle/mob/src/pairing.ts:258-268` 与 `packages/bundle/mob/src/client/PairScreen.tsx:110-115`）——**已修**，见[配对加固笔记](../../implemented/bug-fix/2026-10-07-pairing-session-hardening.zh.md)。
- 在面板的改名输入里按 Escape 会关掉整个对话框并丢掉已显示的短码与二维码，因为 `packages/client/ui-primitives/src/Modal.tsx:47-53` 对任何 Escape 都动作，而仓库里更低优先级的所有者会检查 `defaultPrevented`（`packages/client/ui-layout/src/client/AppFrame.tsx:203-209`）——**已修**，见 [Web 表面笔记](../../implemented/bug-fix/2026-10-07-web-surface-visible-failures.zh.md)。
- 按来源的限流表无界增长：`packages/bundle/mob/src/pairing.ts:97` 没有任何删除路径，`sweep()` 只覆盖会话——**已修**，见[配对加固笔记](../../implemented/bug-fix/2026-10-07-pairing-session-hardening.zh.md)。
- 设备登记抛错时，批准会留下「已决定但未绑定」的会话，且没有重试路径（`packages/bundle/mob/src/pairing.ts:197-206`、`packages/bundle/mob/src/routes.ts:299-317`）——**已修**，见[配对加固笔记](../../implemented/bug-fix/2026-10-07-pairing-session-hardening.zh.md)。
- 双击「允许/吊销/恢复/彻底删除」会发出第二个请求，其拒绝被报成失败；而失败提示也不会被后续成功清除（`packages/bundle/mob/src/client/PairingPanel.tsx:163,185-205`）——**已修**，见[配对加固笔记](../../implemented/bug-fix/2026-10-07-pairing-session-hardening.zh.md)。
- live patch 重载会重新绑定服务端却不重新公告 URL 行（`packages/bundle/web-app/src/index.ts:302,313`）——**已修**，见 [Web 表面笔记](../../implemented/bug-fix/2026-10-07-web-surface-visible-failures.zh.md)。
- 只有客户端 bundle、没有前端 dist 的检出会正常启动、打印 URL 行，然后 `/` 永远 404 且没有构建提示（`packages/bundle/web-app/README.md:37,144` 对 `packages/host/frontend-static/src/index.ts:129-151`）——**已修**，见 [Web 表面笔记](../../implemented/bug-fix/2026-10-07-web-surface-visible-failures.zh.md)。

### 第三梯队 — 校验、协议与文档

设备名经批准可以写入空串或超长串，而改名路由两者都拒绝；配对面板的名称输入也没有长度上限（`packages/bundle/mob/src/routes.ts:293-298` 对 `:374-379`）。三个文案键（`dialog.loading`、`dialog.noLanAddress`、`dialog.loadFailed`）及它们描述的「生成短码失败」状态不可达。请求轮询没有在途去重，慢应答会重绘出更旧的列表——**已修**，见[设备活动笔记](../../implemented/bug-fix/2026-10-07-device-activity-and-request-poll.zh.md)。全零 MAC 可以被存成硬件指纹。`packages/bundle/mob/README.md:64` 说八条 `/pair*` 路由，实际注册十一条；`:44` 声称两条手机路由都受限流，实际只有 `/pair/state` 计数。四个组合文件用 `apps/cli/src/web.ts` 与 `DSH_WEB_MODE` 解释 `shell-env`，两者都已删除。`packages/client/connection/README.md:43` 仍写着 `--host 0.0.0.0` 不受支持，而它已是默认绑定——**已修**，见[设备活动笔记](../../implemented/bug-fix/2026-10-07-device-activity-and-request-poll.zh.md)。回退席位返回 405 时不带 `Allow`。MIME 表缺少已发布 dist 实际包含的字体与图片。`renderIndex()` 在索引响应只会 404 的情形下抛错。webserver 的三个注册表按 key 而非按注册身份删除。`connection.rpc.handle` 注册的路由忽略 `maxRequestBodyBytes`——**已修**，见[channel 上限笔记](../../implemented/bug-fix/2026-10-07-rpc-channel-body-cap.zh.md)。`[::ffff:7f00:1]` 与 `localhost.` 不被判定为回环——**已修**，见[线缆形式笔记](../../implemented/bug-fix/2026-10-07-wire-cookie-and-loopback-forms.zh.md)。多值 `Set-Cookie` 响应会塌缩成最后一个值，而路由自己写的 `set-cookie` 会覆盖已暂存的设备 cookie 续签——**已修**，见[线缆形式笔记](../../implemented/bug-fix/2026-10-07-wire-cookie-and-loopback-forms.zh.md)。`lastSeenAt` 只在配对握手期间推进，因此面板的「最近使用」就是登记时间——**已修**，见[设备活动笔记](../../implemented/bug-fix/2026-10-07-device-activity-and-request-poll.zh.md)。标签边界、全零 MAC、三个不可达的 `dialog.*` 键，以及本 README 的路由数量与限流描述——**已修**，见[批准标签笔记](../../implemented/bug-fix/2026-10-07-approved-labels-and-copy.zh.md)。

## 备选方案

- **一次性修完整个清单。** 否决：三个梯队的爆炸半径不同，第一梯队的每一项都需要自己的行为测试与快照，而把资源泄漏和认证绕过与另外二十七处小改动放进同一个改动里，会让它们无法评审。
- **为每项缺陷开一个 GitHub Issue，而不写这份笔记。** 否决它作为主要记录：审计的价值在于证据与修复顺序，Issue 流会丢掉这两样；而仓库里承载「已评审提案」的持久位置就是这棵树。把工作交给别人时，单个 Issue 仍是正确的归宿。
- **把这些发现留在修好凭证寿命的那个 PR 里。** 否决：那个 PR 是一次修复，带着自己的决策笔记，二十九项清单会把它的评审淹掉。
- **只修本平台上可达的三项，其余丢掉。** 否决：文档与校验类都是单行改动，不修就会继续误导操作者，丢掉它们只会保证下次再审计一遍。

## 验收标准

每一项都连同「修之前会失败」的测试一起落地：一条被取消的下载测试断言 `bridge` 会结算且响应体被取消；一条索引别名请求断言走认证路径；一条局域网推导测试覆盖 VirtualBox host-only 网卡；一条配对测试断言「手机未领取即过期」之后不残留设备行；`apps/cli/tests/pairing.e2e.ts` 变绿；带请求体的 `GET`/`HEAD` 路由在注册期被拒；一条就绪测试断言存在 pending 行时没有 URL 行。第二梯队随各自的组件或宿主测试落地，第三梯队随拥有相应语料的文档门禁落地（`pnpm run test:docs`、`pnpm run doc-sync`）。每一梯队都要让 `pnpm run test:gui`、`pnpm run typecheck` 与所属包的覆盖率维持现状。

## 风险

- 第一梯队的 bridge 修法触及所有路由共用的响应路径；终止条件写错会把「停住的流」变成「被撕裂的流」，因此必须在同一个改动里同时给出取消下载用例与现有流式测试。
- 索引别名的修法不能让大小写敏感文件系统上真实存在的、仅大小写不同的文件变成 404。
- 在会话过期时清理未被领取的设备行，可能吊销一行手机正要领取的记录；该检查必须读签发所读的同一份登记表，并保持现有的「先登记、后发布」次序。
- 把待修项记成提案并不会给它排期；如果这份笔记活得比修复更久，就必须在每个梯队落地时同步更新它，否则它只是又一段过期的散文。
