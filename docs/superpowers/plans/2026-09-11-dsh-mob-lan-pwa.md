# dsh-mob Phase 0-2 实现计划:LAN 放行 + mob profile/二维码 + PWA

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让手机通过内网扫码访问本机 dsh Web UI(token→cookie 认证保留),并提供 `dsh mob` profile 与 PWA 基础。

**Architecture:** 复用现有 web/api 栈:放开 `web-startup` 的 `--host 0.0.0.0` 限制(显式 `--allow-lan` 开关),新 bundle `@deepseek-ai/dsh-mob` 叠加在 web profile 上(重绑 webserver + 终端二维码),新 shipped profile `mob` 与 CLI 别名 `dsh mob`,最后补 PWA manifest/图标/service worker。

**Tech Stack:** TypeScript ESM、Cordis 插件、commander(CLI)、vitest、qrcode-terminal、sharp(仅图标生成 devDep)。

**Spec:** `docs/superpowers/specs/2026-09-11-dsh-mob-design.md`

## Global Constraints

- 每个 npm 包命名 `@deepseek-ai/dsh-<name>`;`@deepseek-ai/cordis` 是 peerDependency(+ devDependency)。
- ESM:`"type": "module"`;包间用包名引用,本地相对 import 带 `.ts` 后缀。
- 测试命令:`pnpm exec vitest run <路径>`(首次或 native 产物缺失时先 `pnpm run build:native-system`)。
- 新包 `packages/*/*/src` 受 CI 逐文件 100% 覆盖率门禁(`pnpm run test:coverage`)。
- 每个非琐碎改动须同 PR 附 Agent Note;PR 分组:Task 1-4 = PR1(LAN serving),Task 5-6 = PR2(mob profile/QR),Task 7 = PR3(PWA)。
- 文档双语:新包需 README.md + README.zh.md + README.i18n.yaml;改 Agent Note 需 `.zh.md` 副本与 sidecar 重录。
- 文件末尾恰好一个换行;commit 信息沿用仓库惯例(如 `feat: ...`)。
- 分支:`feat/dsh-mob`(已存在,spec 已提交其上)。

---

### Task 1: `--allow-lan` 旗标(web-startup)

**Files:**
- Modify: `packages/bundle/web-app/src/startup.ts`
- Test: `packages/bundle/web-app/tests/startup.spec.ts`

**Interfaces:**
- Consumes: 现有 `WebOptions`、`bootProvider()` 测试夹具(startup.spec.ts:41-92)。
- Produces: `WebStartupValues` 不变;CLI 接受 `--allow-lan`(布尔)。Task 3 的 e2e 依赖报错新文案。

- [ ] **Step 1: 改测试(先红)**

在 `packages/bundle/web-app/tests/startup.spec.ts` 中:

(a) 把 :142-148 的拒绝用例文案断言改为新文案:

```ts
  it('rejects the all-interfaces host without --allow-lan before the consumer activates', async () => {
    const { values, observed } = await bootProvider(['--host', '0.0.0.0'])
    expect(observed.out).toContain('--host 0.0.0.0 exposes remote code execution to the network; pass --allow-lan to serve on a trusted LAN, or use 127.0.0.1 instead')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })
```

(b) 紧随其后新增接受用例:

```ts
  it('serves all interfaces when --allow-lan marks the network trusted', async () => {
    const { values, observed } = await bootProvider(['--host', '0.0.0.0', '--allow-lan', '--no-open'])
    expect(values).toEqual({ host: '0.0.0.0', openBrowser: false, trustedHosts: [] })
    expect(observed.readerConfig).toEqual({
      host: '0.0.0.0',
      openBrowser: false,
      port: 3080,
      trustedHosts: [],
    })
    expect(observed.exits).toEqual([])
  })
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm exec vitest run packages/bundle/web-app/tests/startup.spec.ts`
Expected: FAIL(新文案不匹配、--allow-lan 是未知选项报错)。

- [ ] **Step 3: 实现**

`packages/bundle/web-app/src/startup.ts`:

(a) `WebOptions` interface(:35-40)加字段:

```ts
interface WebOptions {
  allowLan?: boolean
  host?: string
  open: boolean
  port?: string
  trustedHost?: string[]
}
```

(b) `webCommand()` 的 option 链(:47-61)在 `.option('--host <host>', 'bind host')` 后加:

```ts
    .option('--allow-lan', 'permit --host 0.0.0.0 on a trusted LAN (plain HTTP; a stolen session cookie grants full control)')
```

并把 addHelpText 的 Examples 块末尾加一行:

```
  dsh --profile web --host 0.0.0.0 --allow-lan
                                             serve to phones on a trusted LAN
```

(注意缩进与既有示例对齐,一行说明文字。)

(c) guard(:74-76)改为:

```ts
    if (options.host === '0.0.0.0' && options.allowLan !== true) {
      program.error('error: --host 0.0.0.0 exposes remote code execution to the network; pass --allow-lan to serve on a trusted LAN, or use 127.0.0.1 instead')
    }
```

(d) 同步该文件顶部 module JSDoc 与 `apply()` 的 JSDoc(:63-68)中 "`--host 0.0.0.0` ... is a usage error" 的表述为 "without `--allow-lan`"。

- [ ] **Step 4: 跑测试确认绿**

Run: `pnpm exec vitest run packages/bundle/web-app/tests/startup.spec.ts`
Expected: PASS(6 个用例)。

- [ ] **Step 5: Commit**

```bash
git add packages/bundle/web-app/src/startup.ts packages/bundle/web-app/tests/startup.spec.ts
git commit -m "feat(web-app): gate --host 0.0.0.0 behind explicit --allow-lan"
```

---

### Task 2: 绑 0.0.0.0 时的统一 stderr 安全警告(web-app runtime)

**Files:**
- Modify: `packages/bundle/web-app/src/index.ts`(`apply()`,:225 起)
- Test: `packages/bundle/web-app/tests/web-app.spec.ts`

**Interfaces:**
- Consumes: `ctx.webServer.host`;模块内常量 `ALL_INTERFACES_HOST`(:82)。
- Produces: 警告文案常量,Task 5 的 mob 插件 README 引用同一行为(不重复实现)。

- [ ] **Step 1: 写测试(先红)**

在 `packages/bundle/web-app/tests/web-app.spec.ts` 的 describe 块内新增:

```ts
  it('warns on stderr when serving all interfaces, and stays silent on loopback', async () => {
    stageDist()
    const lan = new Context()
    lan.provide('webServer', fakeHttpServer('0.0.0.0').server)
    provideConnection(lan)
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(lan, new Config({ openBrowser: false, printUrl: false, surfaceContext: false, trustedHosts: [] }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(diagnostic).toHaveBeenCalledWith('dsh web: WARNING: serving on all network interfaces over plain HTTP; anyone on this network who obtains the session cookie gains full control — use only on a trusted network')
    await lan.fiber.dispose()

    diagnostic.mockClear()
    const local = new Context()
    local.provide('webServer', fakeHttpServer().server)
    provideConnection(local)
    apply(local, new Config({ openBrowser: false, printUrl: false, surfaceContext: false, trustedHosts: [] }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(diagnostic).not.toHaveBeenCalled()
    await local.fiber.dispose()
  })
```

同时:既有第一个用例(:113-164)用的是 `fakeHttpServer('0.0.0.0')`,实现后它会触发警告输出——在该用例 `const log = vi.spyOn(...)` 旁加 `vi.spyOn(console, 'error').mockImplementation(() => {})` 保持输出干净(不断言)。

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm exec vitest run packages/bundle/web-app/tests/web-app.spec.ts`
Expected: FAIL(新用例的 diagnostic 未被调用)。

- [ ] **Step 3: 实现**

`packages/bundle/web-app/src/index.ts` 的 `apply()`(:225)开头,`const runtime = ...` 之后插入:

```ts
  if (ctx.webServer.host === ALL_INTERFACES_HOST) {
    console.error('dsh web: WARNING: serving on all network interfaces over plain HTTP; anyone on this network who obtains the session cookie gains full control — use only on a trusted network')
  }
```

- [ ] **Step 4: 跑测试确认绿**

Run: `pnpm exec vitest run packages/bundle/web-app/tests/web-app.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/bundle/web-app/src/index.ts packages/bundle/web-app/tests/web-app.spec.ts
git commit -m "feat(web-app): warn on stderr when serving all interfaces"
```

---

### Task 3: 真实 CLI e2e——LAN 认证链路

**Files:**
- Modify: `apps/cli/tests/web-auth.e2e.ts`

**Interfaces:**
- Consumes: Task 1 的 `--allow-lan`;`resolveLanTrust` 派生的 trustedHosts(已上线)。
- Produces: 无(验证任务)。

- [ ] **Step 1: 重构 `startWeb` 支持额外旗标**

`apps/cli/tests/web-auth.e2e.ts` 的 `startWeb`(:68)签名改为:

```ts
async function startWeb(root: string, dshHome: string, port: number, extraArgs: string[] = []): Promise<RunningWeb> {
```

spawn 参数数组(:69-74)改为:

```ts
  const child = spawn(process.execPath, [
    '--import', TSX_LOADER,
    DSH_SOURCE_BIN,
    'web',
    '--no-open',
    '--port', String(port),
    ...extraArgs,
  ], {
```

- [ ] **Step 2: 加 LAN 用例(先红——Task 1 未合并时)**

文件顶部 import 加 `import { networkInterfaces } from 'node:os'`。describe 块内新增:

```ts
  it('serves a trusted LAN authority after --allow-lan', { timeout: 180_000 }, async (context) => {
    const lanAddress = Object.values(networkInterfaces()).flat()
      .find(address => address?.family === 'IPv4' && !address.internal)?.address
    if (lanAddress === undefined) {
      context.skip()
      return
    }
    const root = await mkdtemp(join(tmpdir(), 'dsh-web-lan-real-cli-'))
    const dshHome = join(root, '.dsh')
    const port = await freePort()
    let running: RunningWeb | undefined
    try {
      running = await startWeb(root, dshHome, port, ['--host', '0.0.0.0', '--allow-lan'])
      const lanAuthority = `${lanAddress}:${String(port)}`
      expect(running.output()).toContain(`(LAN: http://${lanAuthority}/?token=`)

      // 信任围栏先於认证:LAN authority 已派生为 trusted,无 cookie → 401。
      expect(await describeSettings(port, lanAuthority)).toEqual({ status: 401, body: 'unauthorized' })
      // 未声明的 authority 仍被围栏拒绝(403)。
      expect((await describeSettings(port, `evil.example:${String(port)}`)).status).toBe(403)

      const token = /\(LAN: http:\/\/[^?]+\?token=([^\s)]+)/u.exec(running.output())?.[1]
      if (token === undefined) throw new Error('LAN line omitted the token')
      const exchange = await new Promise<HttpResult>((resolve, reject) => {
        const req = httpRequest({
          hostname: '127.0.0.1',
          port,
          path: `/?token=${token}`,
          method: 'GET',
          headers: { host: lanAuthority },
        }, (res) => {
          res.resume()
          res.on('end', () => {
            resolve({ status: res.statusCode ?? 0, body: res.headers['set-cookie']?.[0] ?? '' })
          })
        })
        req.once('error', reject)
        req.end()
      })
      expect(exchange.status).toBe(303)
      expect(exchange.body).toContain('HttpOnly')
      const cookie = exchange.body.split(';', 1)[0]!

      const authenticated = await describeSettings(port, lanAuthority, cookie)
      expect(authenticated.status).toBe(200)
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${redact(running?.output() ?? '')}`, { cause: error })
    } finally {
      if (running !== undefined) await stopWeb(running)
      await rm(root, { recursive: true, force: true })
    }
  })
```

注:若真机上 token 交换对 303 的 `location` 或 cookie 名有 authority 绑定断言需求,按现有用例(:173-181)的断言风格补;`describeSettings` 已支持自定义 Host 头。

- [ ] **Step 3: 跑 e2e 确认绿**

Run: `pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/web-auth.e2e.ts`
Expected: PASS(两个用例;无 LAN IPv4 的环境自动 skip;Windows 本机上既有用例的 `credentialMode === 0o600` 断言因平台固有原因失败——Task 3 之前就存在,见 ledger,本计划不修复)。
注意:该 e2e 启动真实 CLI,Windows 上首次运行可能接近 90s 超时上限;超时不是失败信号时重跑一次确认稳定性。

- [ ] **Step 4: Commit**

```bash
git add apps/cli/tests/web-auth.e2e.ts
git commit -m "test(cli): cover LAN token exchange through the real CLI"
```

---

### Task 4: Agent Note——LAN Web serving 决策

**Files:**
- Create: `.agents/notes/implemented/architecture/2026-09-11-lan-web-serving.md`
- Create: `.agents/notes/implemented/architecture/2026-09-11-lan-web-serving.zh.md`
- Modify: `.agents/notes/implemented/architecture/2026-07-28-api-browser-trust-boundary.md`(:29 的过时事实 + 交叉链接)
- Modify: `.agents/notes/implemented/architecture/2026-08-24-browser-token-authentication.md`(:23 的过时事实 + 交叉链接)
- 两个旧笔记的 `.zh.md` 副本同步(逐节镜像)

**Interfaces:**
- Consumes: Task 1-3 已合入的行为。
- Produces: 决策记录;supersession 分类(两份旧笔记为**部分** supersede,保持 active 并交叉链接)。

- [ ] **Step 1: 先跑 supersession 检查**

按 `.agents/skills/dsh-archive-agent-notes/SKILL.md` 流程:确认新笔记与 2026-07-28、2026-08-24 两份为部分重叠(仅"CLI 拒绝 0.0.0.0"一句被新行为取代,围栏与认证决策本身不变)——两份旧笔记保持 active,只就地更新事实并交叉链接,不归档。

- [ ] **Step 2: 写新笔记(英文)**

`.agents/notes/implemented/architecture/2026-09-11-lan-web-serving.md`,遵守格式门禁(头三行、`## Problem` 开头、`## Alternatives considered` 必备):

```markdown
# Agent Note: LAN Web serving behind an explicit --allow-lan

Status: implemented

English | [中文](2026-09-11-lan-web-serving.zh.md)

## Problem

Operating the Web UI from a phone requires reaching the Host over the LAN, but the shipped CLI refused `--host 0.0.0.0` outright: the `/api` surface includes remote-code-execution-grade methods, and neither the [browser-trust fence](2026-07-28-api-browser-trust-boundary.md) nor [browser token authentication](2026-08-24-browser-token-authentication.md) was designed to imply supported network deployment. Mobile access was impossible without an operator-maintained proxy, even on a trusted home network where the risk is acceptable.

## Decision

`dsh web` accepts `--host 0.0.0.0` only together with an explicit `--allow-lan` flag (`dsh-web-app/startup`); without it the invocation remains a usage error naming the flag. Binding all interfaces prints a stderr warning at mount time: plain HTTP means anyone on the network who obtains the session cookie gains full control, so the mode is for trusted networks only. The trust fence and token authentication are unchanged: `resolveLanTrust` derives the machine's LAN IP literals into `trustedHosts`, so the LAN authority passes the Host fence while every API call still requires the launch-token-exchanged cookie, which is authority-bound to the LAN host and port.

The `mob` shipped profile (`@deepseek-ai/dsh-mob` layered on `dsh-web-app`) sets `host: 0.0.0.0` through its bundle patch config — a path that never parses CLI flags, so the `--allow-lan` guard does not apply and the mount-time stderr warning carries the safety notice for both paths.

## Alternatives considered

- **Keep the blanket refusal; document a reverse proxy.** Rejected: a proxy asks every mobile user to run extra infrastructure for a deployment the fence and authentication already secure to the level the loopback deployment has.
- **Drop the guard entirely once authentication exists.** Rejected: a bare `--host 0.0.0.0` reads like a routine bind option; the explicit flag makes the security-relevant choice visible at the call site, and the stderr warning states the residual plaintext risk on every start.
- **TLS by default for LAN serving.** Rejected for this change: certificate provisioning on phones has no maintained path in the repo today; the cookie lacks `Secure` by loopback-era design, and adding TLS is a separate deployment contract.

## Consequences

- A phone on the network joins by opening the printed LAN URL (or scanning the QR code the `mob` profile prints); the one-time token exchange issues the same signed cookie the loopback flow uses.
- Residual risk: token exchange and every authenticated request travel in plaintext; a network attacker who steals the cookie holds it until expiry or until the `client-connection/browser-session` grant record is deleted and the process restarts (the existing global revocation).
- The two predecessor notes remain active authority for the fence and for authentication; this note supersedes only their "the CLI rejects `--host 0.0.0.0`" consequence statements.
```

- [ ] **Step 3: 写中文副本并更新旧笔记**

(a) 写 `2026-09-11-lan-web-serving.zh.md`:逐节镜像英文版(`# Agent Note: ` 与 `Status:` 行保持英文原文)。
(b) `2026-07-28-api-browser-trust-boundary.md` :29 "The shipped CLI rejects `--host 0.0.0.0`" 改为:"The shipped CLI gates `--host 0.0.0.0` behind an explicit `--allow-lan` flag; see [LAN Web serving](2026-09-11-lan-web-serving.md). `--trusted-host` only extends the Host/Origin fence and grants no identity." 中文副本同步。
(c) `2026-08-24-browser-token-authentication.md` :23 "The shipped CLI continues to reject `--host 0.0.0.0`. Authentication does not imply supported network deployment..." 改为:"The shipped CLI gates `--host 0.0.0.0` behind `--allow-lan` (see [LAN Web serving](2026-09-11-lan-web-serving.md)). Authentication still does not imply TLS, forwarding-header interpretation, or proxy configuration." 中文副本同步。
(d) sidecar/配对记录按 `docs/i18n/README.md` 的重录流程处理。

- [ ] **Step 4: 跑门禁**

Run: `pnpm run verify-agent-note-format && pnpm run verify-translation-pairing`
Expected: PASS。若 pairing 门禁要求先录 sidecar,按其报错提示的重录命令执行后重跑。

- [ ] **Step 5: Commit**

```bash
git add .agents/notes/
git commit -m "docs(notes): record LAN Web serving decision behind --allow-lan"
```

---

### Task 5: `@deepseek-ai/dsh-mob` bundle 包(二维码插件 + patch)

**Files:**
- Create: `packages/bundle/mob/package.json`
- Create: `packages/bundle/mob/cordis.patch.yml`
- Create: `packages/bundle/mob/src/index.ts`
- Create: `packages/bundle/mob/tests/mob.spec.ts`
- Create: `packages/bundle/mob/README.md`、`README.zh.md`、`README.i18n.yaml`
- Modify: `tsconfig.base.json`(由生成器改,见 Step 6)

**Interfaces:**
- Consumes: `resolveLanTrust`(`@deepseek-ai/dsh-web-app` 导出,src/index.ts:125)、宿主侧 `connection.authenticatedUrl(baseUrl: string): string`(`packages/client/connection/src/rpc.ts:199`,Context 合并声明在 rpc-host.ts:52-57)、`ctx.webServer.host/.port`。
- Produces: bundle patch(Task 6 的 PROFILE_TEMPLATES 引用包名 `@deepseek-ai/dsh-mob`);插件行 id `mob-quick-join`。

- [ ] **Step 1: 脚手架 package.json 与 patch**

以 `packages/bundle/web-app/package.json` 为模板复制 `packages/bundle/mob/package.json`,修改:
- `name` → `@deepseek-ai/dsh-mob`;`description` → `"Serve the DeepSeek Harness Web UI on the LAN and print a phone-join QR code."`
- `exports`:删除 `./startup` 条目,保留 `.`、`./cordis.patch.yml`、`./src/*`、`./package.json`
- `files`:删除 `lib/startup.js`
- `dependencies` 只保留(全部 `workspace:^`,版本对齐家族):`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-client-connection`、`@deepseek-ai/dsh-host-webserver`;新增 `"qrcode-terminal": "^0.12.0"`
- `devDependencies`:新增 `"@types/qrcode-terminal": "^0.12.2"`;cordis 相关 peer/dev 镜像 web-app
- 保留 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`、`publishConfig`、`repository` 等;`version` 与 web-app 一致

`packages/bundle/mob/cordis.patch.yml`:

```yaml
# dsh-mob: serve the Web UI on the LAN and print a phone-join QR code.
# Layers after dsh-web-app: it rebinds the webserver to all interfaces and
# inserts the QR announcer row. A patch replaces the targeted row's whole
# config, so the webserver row restates every key it owns.
- id: webserver
  config:
    host: !!js ctx.webStartup.host ?? '0.0.0.0'
    port: !!js ctx.webStartup.port ?? 3080
    compression: gzip
    compressionLevel: 1
    compressionThresholdBytes: 1024
- insert:
  - id: mob-quick-join
    name: '@deepseek-ai/dsh-mob'
    inject: [webServer]
```

(保留 `!!js` 表达式:`dsh mob --port 8080` 等 CLI 旗标继续生效;CLI 显式 `--host 0.0.0.0` 仍受 Task 1 的 `--allow-lan` 约束。)

- [ ] **Step 2: 写测试(先红)**

`packages/bundle/mob/tests/mob.spec.ts`:

```ts
/**
 * The QR announcer: prints the authenticated LAN URL as a terminal QR code
 * once the tree settles; loopback-only and non-TTY deployments print nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  networkInterfaces: () => ({
    lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    en0: [{ family: 'IPv4', internal: false, address: '192.168.1.5' }],
  }),
}))

vi.mock('qrcode-terminal', () => ({
  default: { generate: vi.fn() },
}))

import qrcode from 'qrcode-terminal'
import { apply } from '../src/index.ts'

const generate = vi.mocked(qrcode.generate)
const LAN_URL = 'http://192.168.1.5:4567/?token=test-token'
const originalIsTTY = process.stdout.isTTY

function setTTY(value: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true })
}

function provideConnection(ctx: Context): void {
  ctx.provide('connection', {
    authenticatedUrl(baseUrl: string) {
      const url = new URL(baseUrl)
      url.searchParams.set('token', 'test-token')
      return url.href
    },
  } as never)
}

function fakeWebServer(host: '127.0.0.1' | '0.0.0.0'): never {
  return { host, port: 4567 } as never
}

beforeEach(() => {
  setTTY(true)
})

afterEach(() => {
  setTTY(originalIsTTY)
  vi.restoreAllMocks()
  generate.mockReset()
})

describe('mob QR announcer', () => {
  it('prints the LAN join line and QR once the tree is ready', async () => {
    const ctx = new Context()
    ctx.provide('webServer', fakeWebServer('0.0.0.0'))
    provideConnection(ctx)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).toHaveBeenCalledWith(`dsh mob: scan to join from this network: ${LAN_URL}`)
    expect(generate).toHaveBeenCalledWith(LAN_URL, { small: true })
    await ctx.fiber.dispose()
  })

  it('prints nothing on a loopback-only deployment', async () => {
    const ctx = new Context()
    ctx.provide('webServer', fakeWebServer('127.0.0.1'))
    provideConnection(ctx)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('prints nothing when stdout is not a TTY', async () => {
    setTTY(false)
    const ctx = new Context()
    ctx.provide('webServer', fakeWebServer('0.0.0.0'))
    provideConnection(ctx)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('does not print again when Connection reloads', async () => {
    const ctx = new Context()
    ctx.provide('webServer', fakeWebServer('0.0.0.0'))
    const first = ctx.plugin((connectionCtx: Context) => { provideConnection(connectionCtx) })
    await first
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).toHaveBeenCalledTimes(1)

    await first.dispose()
    await ctx.plugin((connectionCtx: Context) => { provideConnection(connectionCtx) })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('defers to Loader settlement and drops the announcement on failure or teardown', async () => {
    // Settlement path.
    const settled = new Context()
    settled.provide('webServer', fakeWebServer('0.0.0.0'))
    provideConnection(settled)
    let release: () => void
    const settlement = new Promise<void>((resolve) => { release = resolve })
    settled.provide('loader', { await: () => settlement } as never)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(settled)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    release!()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).toHaveBeenCalledWith(`dsh mob: scan to join from this network: ${LAN_URL}`)
    await settled.fiber.dispose()

    // Failed path.
    log.mockClear()
    generate.mockClear()
    const failed = new Context()
    failed.provide('webServer', fakeWebServer('0.0.0.0'))
    provideConnection(failed)
    failed.provide('loader', { await: async () => { throw new Error('boot failed') } } as never)
    apply(failed)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    await failed.fiber.dispose()

    // Torn-down path.
    log.mockClear()
    const torn = new Context()
    const child = torn.plugin((childCtx: Context) => {
      childCtx.provide('webServer', fakeWebServer('0.0.0.0'))
      provideConnection(childCtx)
    })
    await child
    let releaseTorn: () => void
    const tornSettlement = new Promise<void>((resolve) => { releaseTorn = resolve })
    torn.provide('loader', { await: () => tornSettlement } as never)
    apply(torn)
    await new Promise(resolve => setTimeout(resolve, 0))
    await child.dispose()
    releaseTorn!()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    await torn.fiber.dispose()
  })
})
```

- [ ] **Step 3: 跑测试确认红**

Run: `pnpm exec vitest run packages/bundle/mob`
Expected: FAIL(找不到 `../src/index.ts`)。

- [ ] **Step 4: 实现**

`packages/bundle/mob/src/index.ts`:

```ts
/**
 * Prints the authenticated LAN URL as a terminal QR code once the plugin tree
 * settles, so a phone on the same network joins by scanning. Loopback-only
 * and non-TTY deployments print nothing; the URL line itself is web-app's
 * readiness output.
 * @module @deepseek-ai/dsh-mob
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { resolveLanTrust } from '@deepseek-ai/dsh-web-app'
import qrcode from 'qrcode-terminal'

/** Stable Cordis plugin name. */
export const name = 'mob-quick-join'

/** The LAN URL needs the bound host and port. */
export const inject = ['webServer']

/** Roots that already printed; Connection hot reloads must not reprint. */
const ANNOUNCED_ROOTS = new Set<object>()

/**
 * Mount the QR announcer: waits for Loader settlement like web-app's
 * readiness row, then renders the token-bearing LAN URL.
 * @param ctx - plugin context carrying the webServer service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['connection'], (connectionCtx) => {
    const announce = (): void => {
      if (ANNOUNCED_ROOTS.has(connectionCtx.root)) return
      const lanCandidate = resolveLanTrust(connectionCtx.webServer.host, []).lanAddresses[0]
      if (lanCandidate === undefined || process.stdout.isTTY !== true) return
      ANNOUNCED_ROOTS.add(connectionCtx.root)
      const url = connectionCtx.connection.authenticatedUrl(`http://${lanCandidate}:${String(connectionCtx.webServer.port)}`)
      console.log(`dsh mob: scan to join from this network: ${url}`)
      qrcode.generate(url, { small: true })
    }
    const settled = connectionCtx.get('loader')?.await()
    if (settled === undefined) announce()
    else {
      void settled.then(() => {
        if (connectionCtx.get('webServer') !== undefined
          && connectionCtx.get('connection') !== undefined) announce()
      }, () => {})
    }
  })
}
```

- [ ] **Step 5: 跑测试确认绿 + 覆盖率**

Run: `pnpm exec vitest run packages/bundle/mob`
Expected: PASS(5 个用例)。
再跑 `pnpm run test:coverage` 中该包部分(或直接 `pnpm exec vitest run --coverage packages/bundle/mob`),确认 `src/index.ts` 逐行覆盖——ANNOUNCED_ROOTS 去重、TTY 分支、loader 三分支均有对应用例。

- [ ] **Step 6: 注册 tsconfig paths + 双语 README**

(a) Run: `pnpm run gen-tsconfig-paths`(生成器自动把新包加进 `tsconfig.base.json` 的 paths)。
(b) `packages/bundle/mob/README.md`:包契约——能力(LAN 重绑 + QR)、组成(bundle patch + `mob-quick-join` 插件)、使用方式(`dsh mob`)、限制(明文 HTTP 仅可信网络;警告与吊销见 Agent Note 链接 `.agents/notes/implemented/architecture/2026-09-11-lan-web-serving.md`)、Model Experience 段(按 `docs/cookbook/adding-a-package.md` 第 4 节)。`README.zh.md` 逐节镜像;`README.i18n.yaml` 照抄 web-app 的该文件结构改路径。

- [ ] **Step 7: 跑门禁**

Run: `pnpm run verify-cordis-config && pnpm run verify-tsconfig-paths`
Expected: PASS。若 `verify-cordis-config` 拒绝 patch 里 `@deepseek-ai/dsh-mob` 的自引用,参照 web-app 自引用其子路径(`@deepseek-ai/dsh-web-app/startup`)的先例调整行名或 gate 的白名单逻辑,并在 PR 说明中记录。

- [ ] **Step 8: Commit**

```bash
git add packages/bundle/mob tsconfig.base.json pnpm-lock.yaml
git commit -m "feat(mob): add dsh-mob bundle with LAN rebind and join QR code"
```

(注:新依赖 qrcode-terminal 需先 `pnpm install` 更新 lockfile。)

---

### Task 6: shipped profile `mob` + CLI 别名 `dsh mob`

**Files:**
- Modify: `packages/boot/app-boot/src/profile.ts`(:115 后)
- Modify: `packages/boot/app-boot/tests/profile.spec.ts`(:204-236 区域)
- Modify: `apps/cli/src/args.ts`(:13 JSDoc、:75-85 HELP_EXAMPLES、:188 后)
- Modify: `apps/cli/tests/args.spec.ts`(:24-33 等 web 别名断言的平行用例)
- Modify: `apps/cli/package.json`(dependencies)
- Modify: `apps/cli/composition.md`(生成器产物)
- Modify: `packages/bundle/README.md` + `README.zh.md`(包表格)

**Interfaces:**
- Consumes: Task 5 的 `@deepseek-ai/dsh-mob`。
- Produces: `dsh mob` 与 `dsh --profile mob` 可用;profile 首用自动初始化。

- [ ] **Step 1: profile 模板 + 测试**

(a) `packages/boot/app-boot/src/profile.ts` 的 `PROFILE_TEMPLATES`,在 `web` 条目后加:

```ts
  mob: {
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-mob'],
    patchReload: 'live',
  },
```

(b) `packages/boot/app-boot/tests/profile.spec.ts` :204-236 区域照 web 条目的断言形态加 mob 断言(bundles 三元组、patchReload `'live'`)。

(c) Run: `pnpm exec vitest run packages/boot/app-boot` → PASS。

- [ ] **Step 2: CLI 别名 + 测试**

(a) `apps/cli/src/args.ts` :13 JSDoc 改为:

```
 * `web` and `mob` are hardcoded aliases for `--profile web` / `--profile mob`;
 * `plugin` manages a profile's plugin dependencies by forwarding to pnpm.
```

(b) HELP_EXAMPLES(:75-85)在 `dsh --profile web` 行后加:

```
  dsh mob                                    boot the mob profile: LAN serving + phone-join QR
```

(c) :188(web 块)之后加 mob 块:

```ts
  const mob = program.command('mob').description('boot the mob profile (alias of --profile mob); the web app\'s own flags follow')
  mob
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .enablePositionalOptions()
    .argument('[args...]', 'arguments for the web app (see: dsh mob --help)')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--dump-config', 'print the composed mob-profile tree (with the user layer and any --patch) and exit')
    .option('--dump-default-config', 'print the mob profile\'s bundle layers (no user layer) and exit')
    .action((args: string[], options: BootOptions) => {
      rejectParentOptions('mob')
      resolved = resolveBoot(mob, 'mob', options, args)
    })
```

(d) `apps/cli/tests/args.spec.ts`:为每个 web 别名断言(:24-33、:41-42、:55-56、:71-89、:107-115)加 mob 平行断言——同样的输入,`profile` 期望值为 `'mob'`;`rejectParentOptions` 错误文案中的命令名为 `mob`。

(e) Run: `pnpm exec vitest run apps/cli/tests/args.spec.ts` → PASS。

- [ ] **Step 3: 依赖与生成物**

(a) `apps/cli/package.json` dependencies 按字母序加 `"@deepseek-ai/dsh-mob": "workspace:^"`。
(b) Run: `pnpm install`(刷新 lockfile)。
(c) Run: `pnpm run gen-doc-graphs`(重生成 `apps/cli/composition.md` 等)。
(d) `packages/bundle/README.md` 的包表格加一行 `mob`(用途:LAN serving + join QR;叠于 web-app 之上);`README.zh.md` 同步;按配对门禁要求处理记录。

- [ ] **Step 4: 端到端验证(真实 CLI)**

Run: `pnpm dsh mob --dump-config`
Expected: 输出的插件树含 `mob-quick-join` 行,webserver config 的 host 表达式默认为 `0.0.0.0`。
再 Run: `pnpm exec vitest run apps/cli/tests/profile-initialization.spec.ts packages/boot/app-boot`
Expected: PASS(`it.each(Object.entries(PROFILE_TEMPLATES))` 自动覆盖 mob)。

- [ ] **Step 5: Commit**

```bash
git add packages/boot/app-boot apps/cli packages/bundle/README.md packages/bundle/README.zh.md pnpm-lock.yaml
git commit -m "feat(cli): ship the mob profile and dsh mob alias"
```

---

### Task 7: PWA——manifest、图标、service worker

**Files:**
- Modify: `apps/web/public/manifest.webmanifest`
- Create: `apps/web/public/icon-192.png`、`icon-512.png`、`apple-touch-icon.png`(生成产物)
- Create: `apps/web/scripts/gen-icons.mjs`
- Modify: `apps/web/package.json`(devDependency sharp + script)
- Create: `apps/web/public/sw.js`
- Modify: `apps/web/index.html`
- Modify: `apps/web/src/main.ts`

**Interfaces:**
- Consumes: 现有 `favicon.svg`、`manifest.webmanifest`。
- Produces: 无代码接口(纯 Web 平台资产);README/文档注明 secure-context 限制。

**已知平台约束(实现者必读):** Service Worker 与 install prompt 要求 secure context——`http://<LAN-IP>:3080` 不是 secure context,手机浏览器上 `navigator.serviceWorker` 不存在、不会触发安装提示。本任务交付:localhost/HTTPS 下完整 PWA;内网 HTTP 下 SW 注册静默跳过(守卫自然失效),iOS 经 `apple-mobile-web-app-capable` + touch icon 获得"添加到主屏"全屏体验。完整 LAN 安装体验留给后续 TLS 工作(spec 已记录)。

- [ ] **Step 1: 图标生成脚本 + 产物**

(a) `apps/web/package.json` devDependencies 加 `"sharp": "^0.33.5"`,scripts 加 `"gen-icons": "node scripts/gen-icons.mjs"`;Run: `pnpm install`。
(b) `apps/web/scripts/gen-icons.mjs`:

```js
/** Rasterize the app favicon into the PNG icons the web manifest names. */
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const publicDir = fileURLToPath(new URL('../public/', import.meta.url))
const source = fileURLToPath(new URL('../public/favicon.svg', import.meta.url))

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await sharp(source, { density: 384 }).resize(size, size).png().toFile(`${publicDir}${name}`)
  console.log(`wrote ${name}`)
}
```

(c) Run: `pnpm -C apps/web run gen-icons`;确认三张 PNG 生成且被 `git add`(PNG 二进制提交进仓库,脚本保留以便重生成)。

- [ ] **Step 2: manifest + index.html**

(a) `apps/web/public/manifest.webmanifest` 全文替换为:

```json
{
  "id": "/",
  "name": "DeepSeek Harness",
  "short_name": "DSH",
  "start_url": "/",
  "scope": "/",
  "display": "fullscreen",
  "background_color": "#0b0d10",
  "theme_color": "#0b0d10",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/favicon.svg",
      "sizes": "any",
      "type": "image/svg+xml",
      "purpose": "any"
    }
  ]
}
```

(主题色取值:实现时从 `packages/client/ui-brand-official` 或全局 CSS 的背景色变量取实际值替换 `#0b0d10`,两处保持一致。)

(b) `apps/web/index.html` 的 `<head>` 内,manifest link 之后加:

```html
    <meta name="theme-color" content="#0b0d10" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

- [ ] **Step 3: service worker**

`apps/web/public/sw.js`:

```js
/* dsh static-asset cache: stale-while-revalidate for app files; /api and the
 * realtime WebSocket always go to the network. */
const CACHE = 'dsh-static-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api')) return
  event.respondWith(
    self.caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request)
      const fetched = fetch(event.request).then((response) => {
        if (response.ok) void cache.put(event.request, response.clone())
        return response
      })
      return cached ?? fetched
    }),
  )
})
```

`apps/web/src/main.ts` 末尾加:

```ts
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}
```

- [ ] **Step 4: 验证**

(a) Run: `pnpm run build`(确认 apps/web 构建通过,`dist/` 含 sw.js 与 PNG)。
(b) 手动验证清单(写入 PR 描述):
  - `pnpm dsh web --no-open`,localhost 打开 → DevTools Application 面板:manifest 无错、SW 已注册;
  - `pnpm dsh mob`,手机扫码打开 → 页面正常;iOS Safari"添加到主屏"后全屏打开、图标正确;
  - PC 端既有快照/测试不回归:`pnpm exec vitest run apps/web`(若有)与 `pnpm run test:snapshot` 的相关部分按 `dsh-pre-push-checks` 技能选择。

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): PWA manifest, icons, and static-asset service worker"
```

---

## 收尾(PR 前)

- 按 `.agents/skills/dsh-pre-push-checks/SKILL.md` 选择最小检查集;至少:`pnpm exec vitest run packages/bundle/web-app packages/bundle/mob packages/boot/app-boot apps/cli/tests/args.spec.ts`、`pnpm run verify-cordis-config`、`pnpm run verify-agent-note-format`、`pnpm run verify-translation-pairing`、`pnpm run typecheck`。
- 真机手动验证:`pnpm dsh mob` → 终端出现 QR → 手机扫码 → token 换 cookie → 完整 UI 可用(会话列表、发消息、审批)。
- 推送 `feat/dsh-mob` 到 fork,按仓库 PR 规范拆 PR(Task 1-4 / 5-6 / 7)。
