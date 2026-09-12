# dsh-web LAN 接入与手机配对 设计文档

日期:2026-09-12

状态:待评审(入口合并为待执行;配对为待排期)

承接:`docs/superpowers/specs/2026-09-11-dsh-mob-design.md`(Phase 0-2 已落地并在真机验证)

## 背景与目标

Phase 0-2 已让手机通过 `dsh mob` 接入 Web GUI,真机可用。但当前形态有三个待解问题:

1. **入口分裂**:手机接入是独立 profile(`dsh mob`),它用 bundle patch 直接把 host 设成 `0.0.0.0`,绕过了 `dsh web --allow-lan` 这条显式确认路径;启动安全警告因此只能写 `dsh web:`,而 `packages/bundle/web-app/README.md` 里"`--host 0.0.0.0` requires `--allow-lan`"对 mob profile 并不成立。
2. **认证形态粗糙**:手机凭据是**进程 token 直接放在 URL 里**(`/ ?token=…`),点击一次即换到长期 cookie(默认 30 天,`packages/client/connection/src/index.ts:93`)。该 token 在进程生命周期内可重复使用,且会出现在终端回滚、截图、浏览器历史里。
3. **撤销粒度粗**:吊销只能删 `.credentials.yaml` 的签名密钥 grant 并重启,所有浏览器(包括电脑自己的)一起失效,无法按设备管理。

目标形态:**手机接入成为 `dsh web` 的附属能力**;认证改为**一次性配对码 + 电脑端确认 + 长期设备会话**,支持按设备吊销。

## 已确认决策

| 决策点 | 结论 |
|---|---|
| 命令面 | `dsh web` 为唯一入口;LAN 仍需显式 `--allow-lan`;`dsh mob` 退化为等价别名 |
| 功能归属 | 保留 `@deepseek-ai/dsh-mob` 包名,作为 web profile 的一层;其 patch 不再重绑 webserver |
| 二维码入口 | **不在终端打印**;唯一入口是 设置 → 通用 → 连接手机 |
| LAN 默认 | 不默认开启;理由是明文 HTTP + 无 `Secure` 的 cookie + 本 harness 可执行命令,默认开启等于把 RCE 面变成所有用户的默认 |
| 认证模型 | 不自建账号、不做手机号登录;v1 用设备配对(详见下文"为什么不借官方登录") |
| 传输安全 | TLS 作为独立一期(不在本期),它是唯一能消除嗅探风险的改动 |

## 为什么不借官方登录(评审记录)

曾考虑"借用 DeepSeek 官方登录 + 校验账号一致":

- dsh 目前**没有账号体系**:设置里的 DeepSeek 相关能力是 API Key(provider `deepseek-official`,文案「添加一个 API Key 开始使用」),身份是 `~/.dsh/.anonymous-user-id` 的匿名 UUID;因此"与电脑端账号一致"缺少可比对的一端。
- 未找到面向第三方的官方 OAuth/OIDC 凭据方式;官方对外凭据是 API Key。
- 即便官方提供登录,手机→电脑这一段仍是明文 HTTP,设备 cookie 依旧可被同网段嗅探;官方登录保护的是"手机→DeepSeek"那一跳。**收益错位,且引入外部依赖**(断网或提供方故障时手机无法接入)。
- 若将来 dsh 真有了账号体系,把"手机能登录同一账号"作为配对的**第二因子**成本很低;其实现形态应为**设备码流程**(避免私网明文回调地址被提供方拒绝),本期不做。

## Phase A — 入口合并(为合并进主分支铺路)

目标拓扑:

```
dsh web                          → web profile,默认 loopback
dsh web --allow-lan              → 绑定 0.0.0.0,手机可接入(唯一显式确认入口)
dsh mob                          → 等价别名:--profile web --allow-lan
设置 → 通用 → 连接手机            → 二维码 + 链接 + 已配对设备(唯一界面入口)
```

- `mob` shipped profile 退役:`packages/boot/app-boot/src/profile.ts` 中删除 `mob` 条目,`web` 的 bundle 列表加入 `@deepseek-ai/dsh-mob`;`dsh --profile mob` 变为无效 profile(该 profile 从未进入 master,无兼容负担)。
- `packages/bundle/mob/cordis.patch.yml` 删除 webserver 重绑(host/port/compression 那一段),只保留自己的行;`host` 回到 `webStartup` 的默认与 `--allow-lan` 门禁。
- 终端播报下线:`packages/bundle/mob/src/index.ts` 不再打印加入行与二维码,`qrcode-terminal` 依赖与其三方声明一并移除;`packages/bundle/mob/tests/composition.spec.ts` 相应改写为"web profile 组合下不打印任何东西"。
- 文档口径:`packages/bundle/web-app/README.{md,zh.md}` 的 LAN 一节升为"内置手机接入",`packages/bundle/mob/README.{md,zh.md}` 改为"web profile 的手机接入层",LAN Agent Note 与 PWA Agent Note 中关于 `dsh mob` 与终端二维码的表述同步改写。

验收:`dsh web` 默认仍只绑 loopback;`dsh web --allow-lan` 打印 LAN URL 且**不再**打印二维码;设置页出现「连接手机」;`dsh mob` 与 `--allow-lan` 等价;既有 Web 快照与 e2e 不回归。

## Phase B — 设备配对(v1 认证)

### 威胁模型

| 风险 | 本期处置 |
|---|---|
| URL/二维码里的长期 token 被截图、被历史记录、被旁观 | 配对码**单次使用 + 120 秒有效**;过期即废 |
| 陌生设备自行接入 | 生成配对码与批准都**强制来自 loopback**(必须在电脑本机的浏览器上操作) |
| 配对码被暴力猜测 | 8 位 base32(去掉易混字符),失败限流 + 锁定;码本身不落日志 |
| 设备丢失后仍可访问 | 按设备吊销;吊销立即生效,无需重启 |
| 明文链路上的会话嗅探 | **本期不解决**;由后续 TLS 一期解决(cookie 届时加 `Secure`) |

### 数据模型(沿用 credentials provider,存 `$DSH_HOME/.credentials.yaml`)

- 已有:`client-connection/browser-session` → 签名密钥(32 字节)。
- 新增:`client-connection/paired-devices` → `{ version: 1, devices: [{ id, label, createdAt, expiresAt, lastSeenAt? }] }`。
  - `lastSeenAt` 写回节流(≥1 小时一次),避免每请求写盘。
  - 设备记录被删除即吊销;签名密钥轮换仍是"全员失效"的兜底手段。

### Cookie v2

- 载荷扩展为 `{ version: 2, authority, deviceId, issuedAt, expiresAt }`,MAC 与 cookie 名规则不变(authority 绑定不变,防跨 authority 重放)。
- 校验新增:设备登记表中必须存在该 `deviceId` 且未过期未吊销。
- 电脑本机(loopback)继续沿用 v1 路径:启动 URL 携带进程 token → 换取无 `deviceId` 的 cookie。**v1 cookie 不需要在登记表中出现**,因此电脑自身的启动流程不变。

### 配对流程(电脑发起)

1. 电脑端(loopback)`POST /pair/session` → 生成配对码,返回 `{ code, expiresAt, url }`;TTL 120s。
2. 设置页把 `url`(`http://<lan>:<port>/pair?c=<code>`)渲染成二维码与可复制链接。
3. 手机扫码 `GET /pair?c=<code>` → 未认证可访问(仅此路径),交付 SPA 外壳 + 启动事实 `__DSH_PAIR__ = { code }`。
4. 手机端渲染配对界面(本地化文案),每 2 秒轮询 `GET /pair/state?c=<code>`。
5. 电脑端设置页轮询 `GET /pair/requests` → 显示待确认请求(标签取自 User-Agent,可在确认时修改)。
6. 电脑端点「允许」→ `POST /pair/approve { code, label, allowed }` → 登记设备并把配对码置为 approved。
7. 手机下一次轮询拿到 approved,该响应 `Set-Cookie` 设备 cookie(v2)→ 手机跳转 `/` 正常进入。
8. 拒绝或超时:配对码失效,手机端显示可操作文案(回电脑端重新生成)。

### 接口面

全部注册为 webserver **具名路由**(非 `/api`),因为流程前半段发生在未认证状态:

| 路由 | 栅栏 | 认证 | 来源约束 | 作用 |
|---|---|---|---|---|
| `GET /pair` | 是 | 否 | — | 交付 SPA 外壳 + 配对启动事实 |
| `GET /pair/state?c=` | 是 | 否 | — | 轮询配对状态;approved 时下发设备 cookie |
| `POST /pair/session` | 是 | 是 | loopback | 生成配对码 |
| `GET /pair/requests` | 是 | 是 | loopback | 待确认请求(设置页展示) |
| `POST /pair/approve` | 是 | 是 | loopback | 允许/拒绝 + 设备标签 |
| `GET /pair/devices` | 是 | 是 | — | 已配对设备列表 |
| `POST /pair/revoke` | 是 | 是 | loopback | 吊销指定设备 |

栅栏复用现有判定:`ctx.connection.requestRejection(req)` 返回 `403` 表示 Host/Origin 不在信任集(一律拒绝),返回 `401` 表示仅未认证(配对路由按上表决定放行与否);loopback 约束由路由自行检查 Host 字面量。

### UI

- 设置 → 通用 → 连接手机(现有行扩展为一个面板):
  - 未开启 LAN:提示用 `dsh web --allow-lan` 启动(`mob/loopback-only`)。
  - 已开启 LAN:`添加手机` 按钮 → 二维码 + 链接 + 倒计时;待确认请求带「允许/拒绝」;已配对设备列表带「吊销」。
- 手机端配对界面:同一个 SPA 的配对态(复用 locale 字典,不新增裸文案)。

### 先做哪一步

Phase A 是合并进主分支的前置;Phase B 依赖 A(功能已挂在 web profile 上)。因此顺序为 **A → 合并 → 阶段 3 → B → TLS**;B 与 TLS 的时机可再议。

## 明确不做(YAGNI)

账号体系、手机号/短信登录、passkey、多用户、设备分组与权限、推送通知、TLS 与证书分发(单独一期)、把手机接入扩展到 `dsh mob` 之外的 profile。

## 开放问题(待产品决策)

1. 设备 cookie 寿命默认值(沿用 30 天,还是更长/更短)。
2. 设备标签来源与是否允许在确认时编辑。
3. 是否保留"终端打印加入链接"的旗标开关。
4. `dsh mob` 过渡别名保留多久。
5. LAN 的"长期同意"(settings 级,免每次旗标)是否要做。
6. TLS 形态:自签证书、mkcert,还是走 VPN/隧道。
