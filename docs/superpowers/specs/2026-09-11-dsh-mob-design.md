# dsh-mob 设计文档:手机端内网访问 dsh

日期:2026-09-11

状态:已确认(发布策略暂缓)

## 背景与目标

在手机上实时监控和操作本机运行的 dsh。第一版只通过内网 Web 访问,功能层面一比一复刻 PC 端 Web UI。

关键前提(勘察结论):

- PC Web 端(`apps/web` + `packages/client/*`)已是全功能远程客户端,覆盖会话列表、实时对话流、工具卡片、审批、设置、工作区等全部 dsh 能力。
- 通信为 Typert RPC over HTTP + `/api/remote.mux` 多路复用 WebSocket(心跳、断线重连、断点续传),与设备无关。
- 手机与 PC 访问同一服务器、同一份会话状态,无"同步"问题;手机只是第二个浏览器客户端。
- 唯一的架构级 blocker:`--host 0.0.0.0` 在 `packages/bundle/web-app/src/startup.ts:74` 被硬编码拒绝;而 LAN 信任派生(`resolveLanTrust`,`packages/bundle/web-app/src/index.ts:125`)、`trustedHosts` 围栏(`packages/client/connection/src/api-request-trust.ts`)、token→cookie 认证均已为非 loopback 部署预留完整通路。

已确认的决策:

| 决策点 | 结论 |
|---|---|
| 功能范围 | 完全复刻 PC 端全部功能,走"同一套 client 栈响应式"路线 |
| 认证 | 复用现有 token→cookie 机制;启动时打印带 token 的内网 URL + 终端二维码,手机扫码即登 |
| 移动端形态 | PWA,支持"添加到主屏"全屏运行 |
| 发布策略 | 暂缓。只在本开发机运行,改动以 PR 提交到用户自己的 fork;不考虑第三方分发 |

## 总体架构

```
手机浏览器 (PWA)
   │  http://<LAN-IP>:3080/?token=...   ← 扫码,一次性换 cookie
   ▼
dsh --profile web --host 0.0.0.0 --allow-lan     (PC 上运行,同一进程)
   ├─ webserver 绑 0.0.0.0(配置已支持)
   ├─ resolveLanTrust() 自动派生本机 LAN IP 进 trustedHosts ← 已存在,零改动
   ├─ Host/Origin 围栏 + token→cookie 认证全保留 ← 已存在,零改动
   └─ dsh-mob 插件:打印 LAN URL + 终端二维码
   ▼
Typert RPC over HTTP + /api/remote.mux WebSocket ← 设备无关,零改动
   ▼
session-controller / agent-loop(与 PC 共享同一会话状态)
```

## 改动清单(按 Phase)

### Phase 0 — 放行 LAN(小改动,解锁一切)

- `packages/bundle/web-app/src/startup.ts`:新增 `--allow-lan` 开关。`--host 0.0.0.0` 不带该开关时仍报错(报错文案改为提示加 `--allow-lan`);带开关时放行,并在启动时 stderr 打印醒目安全提示(明文 HTTP、cookie 可被内网嗅探、仅限可信网络)。
- `packages/bundle/web-app/src/index.ts`:`resolveLanTrust` 与 LAN URL 打印(`(LAN: http://...)` 行)已存在,零改动;确认 LAN URL 也走 `authenticatedUrl()` 携带 token(现有代码 :268 已是如此)。
- 认证链路零改动:token→cookie、cookie authority-bound 到 `LAN-IP:port`、`SameSite=Strict`、`HttpOnly` 全部原样生效。
- 新 Agent Note:记录 LAN 部署决策(残余明文窃听风险、吊销机制、保留的防线);就地更新两份旧笔记(`2026-07-28-api-browser-trust-boundary.md`、`2026-08-24-browser-token-authentication.md`)中"CLI 拒绝 0.0.0.0"的过时事实并交叉链接,按 `dsh-archive-agent-notes` 技能做 supersession 检查。

### Phase 1 — dsh-mob 插件 + 二维码

- 新包 `packages/bundle/mob`,包名 `@deepseek-ai/dsh-mob`:bundle patch 层,提供 `dsh --profile mob`(= web profile + patch:默认 `host: 0.0.0.0`、printUrl 开启)。CLI 侧按现有 profile/bundle 机制注册(`apps/cli/src/args.ts` 的 profile 别名先例:`dsh web` → `--profile web`)。
- 两条启动路径:`--allow-lan` 守护的是 CLI 旗标路径(`web-startup` 只解析命令行);mob bundle 经 `cordis.patch.yml` config 设 `host: 0.0.0.0`,不经过该 guard,因此安全提示由 mob 插件自己在激活时打印,两者文案一致。
- 二维码:新增依赖 `qrcode-terminal`(轻量、维护中,符合仓库"优先维护依赖"策略)。在 announceReady 的 LAN URL 输出处追加终端 QR 渲染;仅在存在 LAN URL 且 stdout 为 TTY 时打印。
- 手机扫码 → 带 token 的 URL → 换 HttpOnly cookie → 302 到干净 `/` → 完整 UI。

### Phase 2 — PWA(安装到主屏)

- `apps/web/public/manifest.webmanifest`:补 192/512 图标、`start_url`、名称/主题色。
- 新增手写最小 `sw.js`(静态资源 stale-while-revalidate;`/api` 与 `/api/remote.mux` 永远走网络,不拦截 WebSocket),在 `apps/web/src/main.ts` 注册。不引入 vite-plugin-pwa/workbox。
- **平台约束**:Service Worker 与安装提示要求 secure context——`http://<LAN-IP>` 不是 secure context,内网明文 HTTP 下 SW 不会注册、Android 不出现安装提示。本版交付:localhost/HTTPS 下完整 PWA;内网 HTTP 下经 `apple-mobile-web-app-capable` + touch icon 获得 iOS"添加到主屏"全屏体验;Android 完整安装体验留给后续 TLS 工作。
- README 注明 iOS 限制:iOS PWA 无后台 WebSocket,切回前台时由现有 Connection 代际重连 + RemoteJournalStream 断点续传自动恢复(机制内建,零改动)。

### Phase 3 — 移动端 UI 适配(主体工作量)

混合策略(布局层加层不改层,功能组件直接响应式):

- **布局层**:新增 `packages/client/ui-mob-shell`,在 ≤768px 断点通过 `ui-slots` 机制注入移动布局:底部导航 + 抽屉式会话侧栏 + 全屏主区。桌面布局代码不动;布局级 slot 若不支持替换,则先在既有布局组件内加断点分支(沿用 `ui-brand-official` 的部署方替换先例评估)。
- **功能组件层**:`ui-chat`、`ui-conversation`、`ui-tool`、`ui-approval`、`ui-settings-*`、`ui-workspace` 等逐包加媒体查询与触摸目标(库里已有 9 处 `@media (max-width: …)` 与 `@media (pointer: coarse)` 先例可参照)。
- 验收:PC 端像素级不变(现有快照测试兜底);移动端真机验证核心路径——看会话列表、实时对话流、发消息、工具卡片展开、审批通过/拒绝、修改设置。

## 错误处理与边界

- 手机切后台 WS 被系统挂起 → 现有断线重连补页覆盖,e2e 验证即可,零改动。
- cookie 过期/被吊销 → 401;第一版显示引导文案"请在 PC 端重新运行获取新链接"。吊销机制现成:删除 `$DSH_HOME/.credentials.yaml` 的 grant 记录并重启,所有 cookie 全局失效。
- `host.pickDirectory` 等原生交互弹窗仍弹在 PC 屏幕上,README 注明,第一版不改。
- 明文 HTTP 风险:`--allow-lan` 启动警告 + README 使用建议(仅可信 WiFi,公共网络勿用)。后续版本可考虑自签 TLS 让 cookie 带 `Secure`,不在本版范围。

## 测试

- 单元:`--allow-lan` 开关路径(沿用 `packages/bundle/web-app/tests/startup.spec.ts` 模式)、QR 输出(mock console)、`sw.js` 缓存策略。
- 真实 CLI 测试:临时 `DSH_HOME` 起 `--host 0.0.0.0 --allow-lan`,验证伪造 Host 被拒、LAN Host + token 换 cookie 成功、无 `--allow-lan` 时拒绝。
- PC 端现有快照全部保持绿色(证明一比一未被破坏)。
- 移动端核心路径:真机手动验证清单(第一版);若快照 harness 支持视口,补移动端视口快照。

## 仓库规则遵循

- 新 Agent Note(Phase 0 的 LAN 决策)与代码同 PR;supersession 检查走 `dsh-archive-agent-notes`。
- 推送前检查走 `dsh-pre-push-checks`;文档同步遵循 `docs/AGENTS.md`。
- 新包命名 `@deepseek-ai/dsh-mob`,ESM,`@deepseek-ai/cordis` 为 peerDependency。
- 提交目标:用户自己的 fork,按仓库 PR 规范(labels、PR 拆分)。

## 明确不做(YAGNI)

- 推送通知、离线缓存会话数据、TLS、独立 apps/mob 应用、第三方发布准备、平板专属布局(≥768px 沿用桌面布局)。
