# dsh-web LAN 接入:入口合并 + 设备配对 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把手机接入从独立 `dsh mob` profile 并成 `dsh web` 的附属能力(Phase A),再把"URL 里的进程 token 换长期 cookie"升级为"一次性配对码 + 电脑端确认 + 可吊销设备会话"(Phase B)。

**Architecture:** Phase A 改 profile/bundle 拓扑与终端播报,不动认证。Phase B 在 `@deepseek-ai/dsh-client-connection` 的 `BrowserAuth` 上增加 cookie v2(载荷带 `deviceId`)+ 设备登记表,由 `@deepseek-ai/dsh-mob` 注册 `/pair*` 具名路由承载配对握手(流程前半段必须允许未认证访问,因此不能挂在 `/api` 上)。

**Tech Stack:** TypeScript ESM、Cordis 插件、commander、vitest、Playwright、credentials provider(`$DSH_HOME/.credentials.yaml`)。

**Spec:** `docs/superpowers/specs/2026-09-12-dsh-web-lan-and-pairing-design.md`

**前置状态:** 本计划在隔离工作树 `.worktrees/web-lan-entry`(分支 `feat/web-lan-entry`,基于 `feat/dsh-mob` 的 `20e2ad5b88`)执行。主检出 `D:\Deepseek_Harness` 留在 `feat/dsh-mob` 并继续服务手机,**不要在主检出里改代码或跑构建**。

## Global Constraints

- 每个 npm 包名 `@deepseek-ai/dsh-<name>`;`@deepseek-ai/cordis` 是 peerDependency(+ devDependency)。
- ESM;包间用包名引用,本地相对 import 带 `.ts` 后缀。
- 测试命令:`pnpm exec vitest run <路径>`;覆盖率门禁是 `packages/*/*/src` **逐文件 100%**。
- 每个非琐碎改动同提交附 Agent Note(英文 + `.zh.md` + `.i18n.yaml` 配对记录:`pnpm run verify-translation-pairing --write <路径>`)。
- 文档双语同改;`pnpm run test:docs` 是文档门禁聚合。
- 客户端 UI 文案一律进 typed 字典(zh/en),`verify-client-ui-i18n` 拦截硬编码文案。
- 提交信息沿用单行 conventional commit(`feat(...)` / `fix(...)` / `docs: ...`)。
- 文件末尾恰好一个换行;pre-commit 钩子会跑 lint / notices / whitespace / vendor guard。
- 分支策略:Phase A 完成后才合并进 `master`(fast-forward);Phase B 另起提交序列。
- 开发期简化原则(用户 2026-09-12 确认):设备会话固定 180 天不做滑动续期;设备名只在确认弹窗可改;终端加入链接与 `qrcode-terminal` 直接删除;不做 settings 级 LAN 长期同意;TLS 另起一期。

---

## Phase A — 入口合并

### Task A1: web profile 组合手机接入层,退役 `mob` profile

**Files:**
- Modify: `packages/boot/app-boot/src/profile.ts`
- Test: `packages/boot/app-boot/tests/profile.spec.ts`

**Interfaces:**
- Consumes: 现有 shipped profiles 表(`profile.ts:112-143`)。
- Produces: `web` 的 bundles 变为 `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-mob']`;`mob` 条目删除。

- [x] **Step 1: 先改测试(红)**

在 `profile.spec.ts` 里把 `web` 的期望 bundle 列表补上 `@deepseek-ai/dsh-mob`,并新增一条:请求 `mob` profile 报未知 profile。

- [x] **Step 2: 跑测试确认红**

Run: `pnpm exec vitest run packages/boot/app-boot/tests/profile.spec.ts`

Expected: FAIL(web 列表不含 mob;`mob` 仍被解析)。

- [x] **Step 3: 实现**

`profile.ts`:`web.bundles` 追加 `'@deepseek-ai/dsh-mob'`,删除 `mob` 条目;更新文件顶部关于 profile 列表的 JSDoc(不再提 mob profile)。

- [x] **Step 4: 跑测试确认绿**

Run: `pnpm exec vitest run packages/boot/app-boot/tests/profile.spec.ts`

Expected: PASS。

- [x] **Step 5: 组合校验**

Run: `pnpm dsh --dump-config --profile web`

Expected: 输出含 `mob-quick-join` 行;`pnpm dsh --dump-config --profile mob` 报未知 profile。

- [x] **Step 6: Commit**

```bash
git add packages/boot/app-boot
git commit -m "feat(boot): compose the phone-access layer into the web profile"
```

### Task A2: mob bundle 不再重绑 webserver

**Files:**
- Modify: `packages/bundle/mob/cordis.patch.yml`
- Test: `packages/bundle/mob/tests/web-profile-composition.spec.ts`

**Interfaces:**
- Consumes: `webserver` 行由 `@deepseek-ai/dsh-web-app` 的 patch 拥有(`host` 来自 `webStartup`,受 `--allow-lan` 门禁)。
- Produces: mob patch 只剩自己的行;LAN 绑定回到 `--allow-lan` 这一条显式路径。

- [x] **Step 1: 改 patch**

删除 `- id: webserver / config: {host, port, compression…}` 整段,只保留 `insert: [mob-quick-join]`;更新文件头注释(不再声称重绑)。

- [x] **Step 2: 组合测试断言不重绑**

在 `composition.spec.ts` 的 fixture 树里让 `webServer` 由 fixture 自己提供 host,断言 mob 的 patch 不覆盖它;并保留"快照为空时不打印"的现有用例。

- [x] **Step 3: 验证**

Run: `pnpm exec vitest run packages/bundle/mob`

然后确认组合树:`pnpm dsh --dump-config --profile web`,webserver 行的 `host` 仍是 `!!js ctx.webStartup.host ?? '127.0.0.1'`(不再是 `'0.0.0.0'`)。

- [x] **Step 4: Commit**

```bash
git add packages/bundle/mob/cordis.patch.yml packages/bundle/mob/tests/web-profile-composition.spec.ts
git commit -m "fix(mob): stop rebinding the webserver from the bundle patch"
```

### Task A3: 终端播报下线

**Files:**
- Modify: `packages/bundle/mob/src/index.ts`、`packages/bundle/mob/package.json`(移除 `qrcode-terminal`)、`packages/bundle/mob/tests/mob.spec.ts`
- Test: `packages/bundle/mob/tests/mob.spec.ts`

**Interfaces:**
- Produces: 插件只剩 `MobJoinController` 的挂载;不再读 `process.stdout.isTTY`、不再调用 `qrcode.generate`。

- [x] **Step 1: 先改测试(红)**

把 `mob.spec.ts` 中断言打印加入行/二维码的用例改成"apply 后不产生任何 stdout 输出",删掉 `qrcode-terminal` 的 mock。

- [x] **Step 2: 跑测试确认红**

Run: `pnpm exec vitest run packages/bundle/mob/tests/mob.spec.ts`

- [x] **Step 3: 实现**

`src/index.ts`:删掉 announce 分支与 `qrcode-terminal` import;`apply` 只 `ctx.plugin(MobJoinController)`;更新模块 JSDoc(唯一入口改为设置页)。`package.json` 删除 `qrcode-terminal` 依赖及其 devDependency 镜像(若有)。

- [x] **Step 4: 依赖与披露随动**

Run: `pnpm install`

然后重跑三方声明生成器,确认 `THIRD_PARTY_NOTICES.md` 不再收录 qrcode-terminal。

- [x] **Step 5: 跑测试确认绿**

Run: `pnpm exec vitest run packages/bundle/mob`

Expected: PASS,`src` 逐文件覆盖率 100%。

- [x] **Step 6: Commit**

```bash
git add packages/bundle/mob pnpm-lock.yaml THIRD_PARTY_NOTICES.md
git commit -m "feat(mob): drop the terminal join QR in favor of the settings entry"
```

### Task A4: 删除 `dsh mob` 别名

**Files:**
- Modify: `apps/cli/src/args.ts`、`apps/cli/reference/README.md`
- Test: `apps/cli/tests/args.spec.ts`、`apps/cli/tests/built-bin.e2e.ts`(若引用 `mob`)

**Interfaces:**
- Consumes: 现有硬编码别名机制(`args.ts:13`:`web` / `mob` → `--profile …`)。
- Produces: CLI 只剩 `dsh web`;`dsh mob` 成为普通未知命令(报错并列出可用命令);`--allow-lan` 是唯一的 LAN 入口。

- [x] **Step 1: 先改测试(红)**

`args.spec.ts`:删掉 `mob` 别名断言,新增一条:解析 `mob` 报未知命令/未知 profile;help 文本不再出现 `dsh mob`。

- [x] **Step 2: 跑测试确认红**

Run: `pnpm exec vitest run apps/cli/tests/args.spec.ts`

- [x] **Step 3: 实现**

`args.ts`:删除 `mob` 别名分支、examples 里的 `dsh mob` 行、文件头 JSDoc 中的别名说明;`apps/cli/reference/README.md` 同步删除。

- [x] **Step 4: 跑测试确认绿**

Run: `pnpm exec vitest run apps/cli/tests/args.spec.ts`

- [x] **Step 5: 冒烟**

Run: `pnpm dsh web --allow-lan --no-open --port 0`

Expected: 输出含 `dsh web: … (LAN: http://…)`,且没有 QR 或 `dsh mob: scan to join` 行;随后 `pnpm dsh mob` 报未知命令。

- [x] **Step 6: Commit**

```bash
git add apps/cli
git commit -m "feat(cli): drop the dsh mob alias in favor of dsh web --allow-lan"
```

### Task A5: 文档口径 + 真实组合测试

**Files:**
- Modify: `packages/bundle/web-app/README.md` / `.zh.md` / `README.i18n.yaml`
- Modify: `packages/bundle/mob/README.md` / `.zh.md` / `README.i18n.yaml`
- Modify: `.agents/notes/implemented/architecture/2026-09-11-lan-web-serving.md`(+ `.zh.md` + `.i18n.yaml`)
- Modify: `.agents/notes/implemented/feature/2026-09-12-web-install-metadata-and-service-worker.md`(+ 配对三件套)
- Create: `.agents/notes/implemented/architecture/2026-09-12-phone-access-in-the-web-profile.md`(+ `.zh.md` + `.i18n.yaml`)
- Create: `packages/bundle/mob/tests/web-profile-composition.spec.ts`
- 生成物:`docs/module-graph.*`、`docs/config-catalog.md`(按生成器重跑)

**Interfaces:**
- Produces: web-app README 的 LAN 一节成为"内置手机接入"的唯一说明;mob README 描述为 web profile 的手机接入层;新 Agent Note 记录"功能并入 web profile、LAN 仍显式确认、终端不再打印"的决策。

- [x] **Step 1: 新 Agent Note**

按 `.agents/notes/AGENTS.md` 做 supersession 检查(LAN Note 与 PWA Note 属部分取代,保留并互链),写 Problem/Decision/Alternatives/Consequences。

- [x] **Step 2: README 双语改写 + 记录配对**

Run: `pnpm run verify-translation-pairing --write <三个路径>`

- [x] **Step 3: 真实组合测试(补既有缺口)**

新建 `web-profile-composition.spec.ts`:用真实 Loader 组合 `web` profile 的行(含 mob 行)+ 假 webRuntime,断言 `mob.joinUrl` 在 LAN 快照下返回带 token 的 URL、在 loopback 快照下抛 `mob/loopback-only`、在 `0.0.0.0` 且无地址时抛 `mob/no-lan-address`。

- [x] **Step 4: 生成物重跑**

Run: 仓库实际的 module-graph 与 config-catalog 生成脚本(见 `package.json`)。

Expected: `docs/config-catalog.md` 中 `dsh-mob` 条目仍在,但不再提 webserver 覆盖。

- [x] **Step 5: 门禁**

Run: `pnpm exec vitest run packages/bundle/mob packages/bundle/web-app`

Run: `pnpm run test:docs`

Run: `pnpm run typecheck && pnpm run lint`

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "docs(web): document phone access as a dsh web capability"
```

---

## Phase B — 设备配对

### Task B1: cookie v2(带 deviceId)与设备登记表

**Files:**
- Modify: `packages/client/connection/src/browser-auth.ts`
- Test: `packages/client/connection/tests/browser-auth.host.spec.ts`

**Interfaces:**
- Produces:
  - `BrowserAuth.issueDeviceCookie(authority, deviceId): string`(v2 载荷 `{version: 2, authority, deviceId, issuedAt, expiresAt}`)。
  - 新配置项 `deviceCookieMaxAgeDays`(`packages/client/connection/src/index.ts` 的 schema,`z.natural().min(1).default(180)`),设备登记与 cookie 寿命同源,不做滑动续期。
  - `isAuthenticated` 对 v2 额外要求设备仍在登记表中;v1 路径(无 deviceId)行为不变,电脑本机启动流程不受影响。

- [x] **Step 1: 先写测试(红)**

覆盖:v2 cookie 通过;`deviceId` 不在登记表 → 拒绝;吊销后同一 cookie 立即失效;v1 cookie 行为不变;authority 绑定仍生效。

- [x] **Step 2: 实现 + 登记表读取**

设备登记走 credentials provider 的新记录键 `credentialKey('client-connection', 'paired-devices')`;记录格式非法时抛错(fail loud),不存在时按无设备处理。

- [x] **Step 3: 覆盖与验证**

Run: `pnpm exec vitest run --coverage packages/client/connection`

- [x] **Step 4: Commit**

```bash
git commit -m "feat(connection): carry a revocable device id in the browser cookie"
```

### Task B2: 设备登记表的写入与吊销

**Files:**
- Create: `packages/client/connection/src/devices.ts`
- Test: `packages/client/connection/tests/devices.host.spec.ts`

**Interfaces:**
- Produces: `listDevices()`、`registerDevice({ label, ttlDays })`、`revokeDevice(id)`、`touchDevice(id)`(写回节流 ≥1 小时)。

- [x] **Step 1: 先写测试(红)**

覆盖:注册后可列出;吊销后消失;`touchDevice` 在节流窗口内不写盘;损坏记录抛错。

- [x] **Step 2: 实现**

- [x] **Step 3: 覆盖与验证**

Run: `pnpm exec vitest run --coverage packages/client/connection`

- [x] **Step 4: Commit**

```bash
git commit -m "feat(connection): register, list, and revoke paired devices"
```

### Task B3: 配对会话(短码生命周期)

**Files:**
- Create: `packages/bundle/mob/src/pairing.ts`
- Test: `packages/bundle/mob/tests/pairing.spec.ts`

**Interfaces:**
- Produces: `openSession(): { code, expiresAt }`、`stateOf(code)`、`approve(code, label, allowed)`;码为 8 位 base32(去掉 `0/O/1/I`),TTL 120 秒,单次使用,失败限流(每来源 10 次/10 秒,连续 5 次失败锁定 60 秒)。

- [x] **Step 1: 先写测试(红)**

覆盖:生成→pending→approved;过期;单次使用;限流与锁定;拒绝;未知码。

- [x] **Step 2: 实现**

- [x] **Step 3: 覆盖与验证**

Run: `pnpm exec vitest run --coverage packages/bundle/mob`

- [x] **Step 4: Commit**

```bash
git commit -m "feat(mob): add the pairing session with short-lived single-use codes"
```

### Task B4: `/pair*` 具名路由

**Files:**
- Create: `packages/bundle/mob/src/routes.ts`
- Modify: `packages/bundle/mob/src/index.ts`(注册路由)
- Test: `packages/bundle/mob/tests/routes.host.spec.ts`

**Interfaces:**
- Consumes: `ctx.connection.requestRejection(req)`(`403` = 栅栏拒绝;`401` = 仅未认证;`undefined` = 已认证)、`ctx.webServer.register({ kind: 'exact', path, handler })`、`isLoopbackHostname`。
- Produces: spec 中的路由表 `/pair`、`/pair/state`、`/pair/session`、`/pair/requests`、`/pair/approve`、`/pair/devices`、`/pair/revoke`。

**实现要点:** `403` 一律拒绝;`/pair` 与 `/pair/state` 允许 `401`(仍走栅栏与限流);其余要求已认证**且** Host 为 loopback 字面量;批准成功后下发设备 cookie。

- [x] **Step 1: 先写测试(红)**

覆盖:未认证可访问 `/pair`;伪造 Host 得到 403;非 loopback 调 `/pair/approve` 得到 403;批准后响应带 `Set-Cookie`;吊销后同一 cookie 请求 `/api` 得到 401。

- [x] **Step 2: 实现**

- [x] **Step 3: 覆盖与验证**

Run: `pnpm exec vitest run --coverage packages/bundle/mob`

- [x] **Step 4: Commit**

```bash
git commit -m "feat(mob): serve the phone pairing handshake over named routes"
```

### Task B5: 手机端配对界面

**Files:**
- Modify: `packages/bundle/mob/src/client/*`(新增配对态组件与字典条目)
- Modify: `packages/bundle/mob/src/routes.ts`(`/pair` 交付 SPA 外壳 + 启动事实 `__DSH_PAIR__`)
- Test: `packages/bundle/mob/tests/pair.client.spec.tsx`

- [x] **Step 1: 先写组件测试(红)**

覆盖:轮询 pending→approved 后跳转 `/`;denied 与 expired 的文案;限流文案。

- [x] **Step 2: 实现(文案进字典,zh/en 同改)**

- [x] **Step 3: 验证**

Run: `pnpm exec vitest run packages/bundle/mob`

Run: `pnpm run verify-client-ui-i18n`

- [x] **Step 4: Commit**

```bash
git commit -m "feat(mob): render the phone pairing screen"
```

### Task B6: 设置面板(生成码 / 待确认 / 设备列表 / 吊销)

**Files:**
- Modify: `packages/bundle/mob/src/client/ConnectPhoneRow.tsx`(保留"未开启 LAN"提示)
- Create: `packages/bundle/mob/src/client/PairingPanel.tsx`
- Modify: `packages/bundle/mob/src/controller.ts`
- Test: `packages/bundle/mob/tests/row.client.spec.tsx`、`packages/bundle/mob/tests/panel.client.spec.tsx`

- [x] **Step 1: 先写测试(红)**

覆盖:生成码后渲染二维码与倒计时;待确认出现允许/拒绝,且名称输入框预填 UA 解析出的设备名并可改;设备列表显示标签与时间;吊销后该行消失;非 loopback 环境隐藏这些操作。

- [x] **Step 2: 实现**

- [x] **Step 3: 验证**

Run: `pnpm exec vitest run packages/bundle/mob`

- [x] **Step 4: Commit**

```bash
git commit -m "feat(mob): manage pairing and paired devices from settings"
```

### Task B7: 端到端与真机验证 + Agent Note

**Files:**
- Create: `apps/cli/tests/pairing.e2e.ts`
- Create: `.agents/notes/implemented/feature/2026-09-12-phone-device-pairing.md`(+ `.zh.md` + `.i18n.yaml`)

- [x] **Step 1: 真实 CLI e2e**

临时 `DSH_HOME` 起 `dsh web --host 0.0.0.0 --allow-lan`,按顺序断言:loopback `POST /pair/session` 拿到码;LAN authority 无 cookie 请求 `GET /pair?c=<code>` 得 200;loopback 已认证 `POST /pair/approve` 得 200;LAN authority 带设备 cookie 请求 `/api/…` 得 200;`POST /pair/revoke` 后同一 cookie 得 401;伪造 Host 的 `/pair*` 得 403。

- [x] **Step 2: Agent Note**

记录配对决策(威胁模型、为什么不借官方登录、为什么批准必须来自 loopback、残余的明文嗅探风险与 TLS 的位置),并按 supersession 规则与 LAN Note 互链。

- [x] **Step 3: 门禁**

Run: `pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/pairing.e2e.ts`

Run: `pnpm run typecheck && pnpm run lint && pnpm run test:docs`

- [x] **Step 4: 真机清单(手动,写进 PR 描述)**

手机扫码 → 电脑端出现待确认 → 允许 → 手机进入会话列表 → 关闭浏览器再打开 LAN 地址仍在登录态 → 电脑端吊销后手机刷新变 401 并出现"登录已失效"提示。

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(mob): pair a phone through a one-time code and a device session"
```

---

## 收尾(合并进主分支前)

- [x] `pnpm run build` 绿;`pnpm run lint` 0 错;`pnpm run test:docs` 全过(另跑 `verify-export-jsdoc`、`verify-type-equiv`、`verify-config-catalog`、`verify-subsystem-pages`、`website:build` 均通过;`duplication`、`verify-node-next-types`、`verify-cordis-config` 在 master 上以相同方式失败,属既有环境问题)。
- [x] Run: `pnpm exec vitest run packages/client/connection packages/client/web packages/client/ui-primitives packages/client/ui-settings-general packages/bundle/mob packages/bundle/web-app packages/boot/app-boot apps/cli/tests/args.spec.ts`(1328 通过;唯一失败是 `ui-primitives/tests/icons.client.spec`,与本改动无关且 master 同样失败)。
- [x] Run: `pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/web-auth.e2e.ts apps/cli/tests/pairing.e2e.ts`(3/3 通过)。
- [x] Run: `DSH_SNAPSHOT=replay pnpm run test:web:built` 的 settings 与 boot 场景(`settings-chrome`、`lifecycle-chrome`、`pwa-manifest` 共 22 条全过)。
- [x] 冒烟:`dsh web`(默认 loopback)、`dsh web --allow-lan`(LAN URL、无二维码)、确认 `dsh mob` 已是未知命令。
- [ ] 合并顺序:打 checkpoint 标签(`checkpoint/web-pairing-verified`,已打)→ 主检出 `git merge --ff-only feat/web-pairing` → `pnpm install` → `pnpm run build` → 重启 `dsh web`(待操作者执行:主检出托管着当前会话,代理不得重启它)。
- [ ] 合并后手机端按下面的真机清单走一遍。

### 第二轮修复:启动令牌仅回环可用

真机走查的第 5、6 项暴露一个缺口:手机若先打开过带令牌的 LAN URL,就持有了一份 v1 启动令牌 cookie,而 `isAuthenticated` 当时在任何 authority 上都承认它——于是电脑端吊销设备后,手机仍靠这份 cookie 继续访问。

- [x] `BrowserAuth.authorizeIndex` 只在回环 authority 上交换启动令牌,`isAuthenticated` 也只在回环上承认 v1 cookie(`6cf55029fb`)。
- [x] `dsh web` 的 LAN 就绪行与 `mob.joinUrl` 改为不带令牌的 origin(`8be795644b`)。
- [x] Agent Note 与各 README 同步该规则(`36687ed7dd`)。
- [x] Run: `pnpm run test:docs`(16/16 通过)、`pnpm exec vitest run packages/client/connection packages/bundle/mob packages/bundle/web-app`、`pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/web-auth.e2e.ts apps/cli/tests/pairing.e2e.ts`(3/3 通过)。
- [x] 合并与重启同上(操作者执行);真机复验第 5、6 项通过:吊销后手机刷新被挡下,重新配对后恢复访问。第 7 项的界面表现暴露第三处缺口,见下。
- [x] 路线图遗留:第一轮的合并步骤(第 434、435 行)已由操作者完成,`master` 现为 `20a9c9752a`。

### 第三轮修复:被拒绝的局域网页面给出去向

真机复验第 7 项暴露的缺口:吊销后手机**刷新**时,index 文档请求直接得到 401 纯文本 `dsh web authentication required; reopen the URL printed by dsh web.`。手机上既没有可打开的打印 URL,应用外壳也没送到,所以本地化提示没有机会渲染。

- [x] `authorizeIndex` 改为三态判定 `serve` / `answered` / `auth-required`;非回环 authority 上的拒绝不再由 Connection 写响应,而是交给 index 所有者(`ConnectionIndexAccess`)。
- [x] `frontend-static` 在 `auth-required` 时以 401 提供外壳本身,并在 `<head>` 后注入 `__DSH_AUTH_REQUIRED__` 启动事实。
- [x] mob 浏览器半层新增「登录已失效」全屏界面(`shell.overlay`,order 90)、中英文案与「重新加载」按钮;`/pair` 页面仍优先渲染配对界面。
- [x] 覆盖:connection 单测(三态 + 已配对/已吊销设备 cookie)、`frontend-static` 真实组合测试(LAN 匿名 401 HTML + 事实,设备 cookie 后 200 无事实)、mob 组件与注册测试、真实 CLI e2e(LAN 带/不带令牌都是 401 + 事实 + 无 cookie,回环仍是纯文本 401)。
- [x] 加固:`authorizeIndex` 在交出 `auth-required` 之前先过 Host/Origin 栅栏,因此只有**受信** authority 能拿到外壳,伪造 Host 仍得到纯文本 401(组合测试覆盖;`9d5a977fdb`)。
- [ ] 合并与重启同上(操作者执行),然后真机清单第 7 项应显示「登录已失效」全屏界面(含 设置 → 通用设置 → 连接手机 的指引与重新加载按钮),而不是英文纯文本页。

### 真机验证清单(操作者执行)

1. 主检出:停掉正在跑的 `dsh web`,执行 `git merge --ff-only feat/web-pairing`、`pnpm install`、`pnpm run build`,再以 `pnpm dsh web --host 0.0.0.0 --allow-lan` 启动。
2. 电脑端:设置 → 通用设置 → 连接手机 → 生成配对码;应出现二维码、8 位短码与剩余秒数倒计时。
3. 手机端:扫码打开 `/pair`(或手动打开链接);屏幕应显示同一个短码与「请在电脑端确认这台手机以完成配对。」
4. 电脑端:「待确认的请求」出现该请求,设备名称已按手机 UA 预填且可改;点「允许」。
5. 手机端:1.5 秒内自动跳到会话列表;关掉浏览器再打开 LAN 地址,仍在登录态。
6. 电脑端:「已配对的设备」列出刚配对的设备(名称、添加时间、最近使用时间);点「吊销」。
7. 手机端:刷新后应出现「登录已失效,请在电脑端重新扫码」,并且 `/api` 请求返回 401。
