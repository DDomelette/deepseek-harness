# dsh-notes Phase 0-1 实现计划:包骨架 + 宿主半边

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 `@deepseek-ai/dsh-notes` 包并通过全部注册门禁,然后实现它的宿主半边——存储域、素材与会话记录、线程归属、设置、会话创建、Remote 命名空间,以及"素材变成模型请求"的完整编排。

**Architecture:** 单包双半边。宿主半边 `src/index.ts` 是一个 `TypertRemoteService`,由它打开 `ctx.storageDomain` 上的自有域、注册 `ctx.settings` 命名空间、按设置创建真实的 dsh 会话,并把素材编排成 `followup()` 的 user message。浏览器半边 `src/client/` 本计划只建空壳(Phase 2 填充),但包的骨架、tsconfig 双面布局与五处注册在本计划内一次性做对,后续不再返工。

**Tech Stack:** TypeScript ESM、Cordis 插件、Typert Remote、zod(存储记录 schema)、schemastery(设置与 Config schema)、vitest。

**Spec:** `docs/superpowers/specs/2026-09-11-dsh-notes-design.md`

## Global Constraints

- 包名 `@deepseek-ai/dsh-notes`,路径 `packages/notes/notes`。**不是** `packages/client/ui-notes`——`packages/client/AGENTS.md` 规定该目录下新包的宿主半边必须为空,而本包宿主半边很重。双半边先例见 `packages/session-query/session-log-export`。
- ESM:`"type": "module"`;包间用包名引用,本地相对 import 带 `.ts` 后缀。
- `@deepseek-ai/cordis` 同时进 `peerDependencies` 与 `devDependencies`(版本对齐家族)。
- 存储用 **zod**(`import { z } from 'zod'`);设置与插件 `Config` 用 **schemastery**(`import s from '@deepseek-ai/schemastery'`)。两者不可混用。
- `src/types.ts` 只放类型,不放运行代码。
- 测试放包级 `tests/`,不放 `src/__tests__/`。jsdom 环境靠每个 spec 首行的 `// @vitest-environment jsdom` pragma,共享配置保持 node-env。
- `packages/*/*/src` 在 CI 逐文件 100% 覆盖率门内(`pnpm run test:coverage`)。确实不可达的防御分支写 `/* v8 ignore -- <真实原因> */`,不许裸 ignore。
- 注册类贡献必须证明可释放(HMR 安全):dispose fiber 后观察移除。
- 产品可见文案走类型化 locale 字典,`verify-client-ui-i18n` 拒绝硬编码字符串。
- 新包 README 是双语文档:必须同时有 `README.md`、`README.zh.md`、`README.i18n.yaml`,且 `verify-translation-pairing` 会校验三者一致。
- 非琐碎改动必须同 PR 附 Agent Note。
- 文件末尾恰好一个换行。
- 命令前缀:本计划所有命令在 worktree `.worktrees/dsh-notes` 下执行,测试命令用 `pnpm exec vitest run <路径>`。
- 计划内的 TypeScript 代码块一律用 ` ```text ` 围栏,不用 ` ```ts `——`doc-typecheck` 会强制编译 ```ts 块,而计划里的代码是待实现的片段。

---

### Task 1: 包骨架

**Files:**
- Create: `packages/notes/notes/package.json`
- Create: `packages/notes/notes/tsconfig.json`
- Create: `packages/notes/notes/tsconfig.host.json`
- Create: `packages/notes/notes/tsconfig.client.json`
- Create: `packages/notes/notes/tsdown.config.ts`
- Create: `packages/notes/notes/src/index.ts`
- Create: `packages/notes/notes/src/client/index.ts`
- Create: `packages/notes/notes/src/types.ts`

**Interfaces:**
- Consumes: 无(本任务是全计划的起点)。
- Produces: 包名 `@deepseek-ai/dsh-notes`;导出面 `.`、`./client`、`./types`;后续所有任务都往 `src/index.ts` 与 `src/types.ts` 里加东西。

- [ ] **Step 1: 写 `package.json`**

以 `packages/session-query/session-log-export/package.json` 为模板。本任务先不声明 `./typert` 与 `./remote`——那两个是 Task 10 的产物,提前声明会让 `pnpm run hygiene` 找不到文件而红。

```text
{
  "name": "@deepseek-ai/dsh-notes",
  "description": "Web notes panel: collect text and screenshots from a dsh session, keep them as materials, and have a configured model answer each one in its own conversation.",
  "version": "0.1.5-rc.1",
  "publishConfig": { "access": "public" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deepseek-ai/deepseek-harness.git",
    "directory": "packages/notes/notes"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./types": { "types": "./lib/types/types.d.ts", "default": "./lib/types/types.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "inject": ["@deepseek-ai/dsh-api-remotes", "@deepseek-ai/dsh-client-ui-renderer"],
      "platform": "web"
    }
  },
  "scripts": { "bundle": "tsdown", "watch": "tsdown --watch" },
  "license": "MIT",
  "peerDependencies": {
    "@deepseek-ai/cordis": "workspace:^",
    "@deepseek-ai/dsh-storage-domain": "workspace:^"
  },
  "dependencies": {
    "@deepseek-ai/dsh-brand": "workspace:^",
    "@deepseek-ai/dsh-llm": "workspace:^",
    "@deepseek-ai/schemastery": "workspace:^",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "workspace:^",
    "@deepseek-ai/dsh-agent": "workspace:^",
    "@deepseek-ai/dsh-api-remotes": "workspace:^",
    "@deepseek-ai/dsh-client-ui-renderer": "workspace:^",
    "@deepseek-ai/dsh-session": "workspace:^",
    "@deepseek-ai/dsh-settings": "workspace:^",
    "@deepseek-ai/dsh-storage": "workspace:^",
    "@deepseek-ai/dsh-storage-domain": "workspace:^",
    "@deepseek-ai/dsh-storage-json": "workspace:^"
  },
  "files": [
    "lib/index.js",
    "lib/client.js",
    "lib/types/**/*.js",
    "lib/types/**/*.d.ts"
  ]
}
```

`version` 必须与家族其余包一致;先照抄 `packages/session-query/session-log-export/package.json` 的 `version` 字段,不要凭记忆填。

**依赖分节不是随手放的,每个 specifier 归哪一节由 `scripts/package-dependency-policy.ts` 决定,且 `verify-package-dependencies` 会机械校验。** 上面的分节按两个真实先例推出(`packages/workspace/workspace` 是有 zod 域 + `storage-domain` 的宿主包,`packages/session/session-projection-cache` 是有 schemastery 的宿主包):

- **`dependencies`** —— 宿主半边在**运行时**引用的值:`zod`(域 schema)、`@deepseek-ai/schemastery`(设置 schema)、`@deepseek-ai/dsh-brand`(`brandString`)、`@deepseek-ai/dsh-llm`(`createUserMessage`)。
- **`peerDependencies` + `devDependencies` 成对** —— 身份必须共享的包。`@deepseek-ai/dsh-storage-domain`(`defineDomain`/`domainTable`)按 `workspace/workspace` 的先例放这里,两边都要写。
- **`devDependencies` 独有** —— 只有测试或类型引用的包(`dsh-storage`、`dsh-storage-json`、`dsh-settings`、`dsh-agent`、`dsh-session`)。
- **浏览器与类型关系一律 dev-only**(`dsh-api-remotes`、`dsh-client-ui-renderer`,以及 `dsh.client.inject` 里列的那些)。

**上面这份分节不要当成定论。** 写完 manifest 后跑一次自动修复,以验证器的裁决为准:

```
pnpm run verify-package-dependencies --fix
```

它会按策略改写分节并打印改动。若它拒绝了某个 specifier(报"unclassified export"),那是策略文件里还没有这条登记,需要按它的提示处理——不要绕过。

- [ ] **Step 2: 写三个 tsconfig**

双面布局:`tsconfig.json` 只做 solution,不含编译单元。范本是 `packages/client/file-upload/` 的同名三件套。

`tsconfig.json`:

```text
{
  "files": [],
  "references": [
    { "path": "./tsconfig.host.json" },
    { "path": "./tsconfig.client.json" }
  ]
}
```

`tsconfig.host.json`——`files` 逐个列出宿主半边源文件(不用 `include`,双面包靠显式文件列表把两个面分开):

```text
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib/types",
    "tsBuildInfoFile": "lib/tsconfig.host.tsbuildinfo"
  },
  "files": ["src/index.ts", "src/types.ts"],
  "references": [
    { "path": "../../../vendor/cordis" }
  ]
}
```

`tsconfig.client.json`:

```text
{
  "extends": "../../../tsconfig.base.client.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib/types",
    "tsBuildInfoFile": "lib/tsconfig.client.tsbuildinfo"
  },
  "files": ["src/client/index.ts", "src/types.ts"],
  "references": [
    { "path": "../../../vendor/cordis" }
  ]
}
```

后续任务往任何半边加源文件时,**必须同步把文件名加进对应 tsconfig 的 `files` 数组**;漏加的表现是 typecheck 通过但构建产物缺文件。

- [ ] **Step 3: 写 `tsdown.config.ts`**

```text
import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-notes', ['lib/types/index.js'])
```

- [ ] **Step 4: 写两个半边的最小 `apply`**

`src/index.ts`:

```text
/**
 * Web notes panel, node half. Opens the plugin's storage domain, serves the
 * notes settings namespace, and drives materials into dsh Sessions.
 * @module @deepseek-ai/dsh-notes
 */

import type { Context } from '@deepseek-ai/cordis'

/** Host plugin body. */
export function apply(ctx: Context): void {
  // Filled in by later tasks; the empty body keeps the Loader row live.
  void ctx
}
```

`src/client/index.ts`:

```text
/**
 * Web notes panel, browser half. The panel, the selection bubble, and the
 * settings card arrive in later phases.
 * @module @deepseek-ai/dsh-notes/client
 */

import type { Context } from '@deepseek-ai/cordis'

/** Client plugin body. */
export function apply(ctx: Context): void {
  void ctx
}
```

`src/types.ts`:

```text
/** Shared public types of the notes plugin. */
```

- [ ] **Step 5: 安装依赖并确认包被 pnpm 识别**

Run: `pnpm install`

Expected: 成功,且 `pnpm ls --filter @deepseek-ai/dsh-notes --depth -1` 列出该包。

- [ ] **Step 6: 确认两个半边都能被 typecheck**

Run: `pnpm exec tsc -b packages/notes/notes/tsconfig.json`

Expected: 退出码 0,生成 `lib/types/tsconfig.host.tsbuildinfo` 与 `lib/types/tsconfig.client.tsbuildinfo`。

- [ ] **Step 7: 提交**

```bash
git add packages/notes/notes
git commit -m "feat(notes): add the plugin package skeleton"
```

---

### Task 2: 五处注册(双面包比单面包多两处)

**Files:**
- Modify: `tsconfig.base.json`
- Modify: `tsconfig.host.json`
- Modify: `tsconfig.client.json`
- Modify: `packages/bundle/web-app/cordis.patch.yml`
- Modify: `packages/bundle/web-app/package.json`
- Test: `packages/notes/notes/tests/node-plugin.host.spec.ts`

**Interfaces:**
- Consumes: Task 1 的包名与导出面。
- Produces: 包进入 Loader 与浏览器 boot graph;后续任务不需要再碰这五个文件。

- [ ] **Step 1: `tsconfig.base.json` 加 `paths`**

在 `paths` 块内按字母序插入(现有邻居 `@deepseek-ai/dsh-mob` 与 `@deepseek-ai/dsh-session` 之间):

```text
      "@deepseek-ai/dsh-notes": ["./packages/notes/notes/src"],
      "@deepseek-ai/dsh-notes/client": ["./packages/notes/notes/src/client/index.ts"],
      "@deepseek-ai/dsh-notes/types": ["./packages/notes/notes/src/types.ts"],
```

三条都要:`/client` 让浏览器半边可被跨包类型引用,`/types` 让共享类型可被引用。

- [ ] **Step 2: 两个根聚合各加一条 reference**

`tsconfig.host.json` 加:

```text
    { "path": "./packages/notes/notes/tsconfig.host.json" },
```

`tsconfig.client.json` 加:

```text
    { "path": "./packages/notes/notes/tsconfig.client.json" },
```

注意路径带 `/tsconfig.host.json` 与 `/tsconfig.client.json` 后缀——那是双面包的形态;单面客户端包只写目录名(`{ "path": "./packages/client/ui-jobs" }`)。写错的表现是 `tsc -b` 报找不到 project。

- [ ] **Step 3: 写加载测试(先红)**

`packages/notes/notes/tests/node-plugin.host.spec.ts`:

```text
/**
 * The host half mounts through a real Loader tree and unmounts cleanly: the
 * plugin contributes no service yet, so this asserts the plugin lifecycle
 * alone — the row resolves, the fiber reaches active, and disposal is clean.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, inject } from '../src/index.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

describe('notes host half', () => {
  it('activates and disposes without a service dependency', async () => {
    ctx = new Context()
    const mounted = ctx.plugin({ apply, inject })
    await mounted.await()
    expect(mounted.fiber.state).toBe(2)
    await mounted.dispose()
    expect(mounted.fiber.state).not.toBe(2)
  })
})
```

`fiber.state` 的整数值含义以 `@deepseek-ai/cordis` 的 `FiberState` 为准;写测试时先运行一次看实际值,不要照抄这里的 `2`——把断言改成与该枚举成员比较(`FiberState.ACTIVE`)才是正确写法。

- [ ] **Step 4: 跑测试确认红**

Run: `pnpm exec vitest run packages/notes/notes/tests/node-plugin.host.spec.ts`

Expected: FAIL——`../src/index.ts` 尚未导出 `inject`(Task 1 的 `apply` 没有 `inject`)。

- [ ] **Step 5: 导出 `inject` 让测试转绿**

`src/index.ts` 加上:

```text
/** Services the host half needs. Filled in as later tasks add dependencies. */
export const inject: string[] = []
```

- [ ] **Step 6: 跑测试**

Run: `pnpm exec vitest run packages/notes/notes/tests/node-plugin.host.spec.ts`

Expected: PASS。

- [ ] **Step 7: 注册到 web-app 的两处**

`packages/bundle/web-app/cordis.patch.yml` 在客户端平面行附近插入:

```text
    # Web notes panel: materials collected from the conversation, each answered
    # by the configured model in its own conversation.
    - id: notes
      name: '@deepseek-ai/dsh-notes'
```

`packages/bundle/web-app/package.json` 的 `dependencies` 加一行(按字母序):

```text
    "@deepseek-ai/dsh-notes": "workspace:^",
```

- [ ] **Step 8: 跑注册门禁**

Run: `pnpm run verify-cordis-config`

Expected: 退出码 0。该门禁要求 cordis 行里的裸包名出现在所属 manifest 的 `dependencies` 里——Step 7 两处必须同时改,只改一处会红。

- [ ] **Step 9: 跑包与依赖门禁**

```bash
pnpm run verify-package-dependencies
pnpm run verify-client-packages
```

Expected: 两者都退出码 0。

`verify-package-dependencies` 若报分节不对,按它的提示修 `package.json`(或先跑一次 `--fix` 看它想怎么改,再决定是否接受);若报"unclassified export",说明某个宿主运行时 import 还没在 `scripts/package-dependency-policy.ts` 里登记,需要按该文件的既有形态补登记——**不要靠改 import 绕开**。

- [ ] **Step 10: 提交**

```bash
git add tsconfig.base.json tsconfig.host.json tsconfig.client.json \
        packages/bundle/web-app/cordis.patch.yml packages/bundle/web-app/package.json \
        packages/notes/notes
git commit -m "feat(notes): register the package in the web profile"
```

---

### Task 3: 包 README(双语文档三件套)

**Files:**
- Create: `packages/notes/notes/README.md`
- Create: `packages/notes/notes/README.zh.md`
- Create: `packages/notes/notes/README.i18n.yaml`

**Interfaces:**
- Consumes: Task 1 的包名。
- Produces: 通过 `verify-translation-pairing` 的三件套;后续每个任务改动行为时同步更新 README 契约。

- [ ] **Step 1: 写 `README.md`**

按 `packages/client/ui-message-feedback/README.md` 的章节骨架。必须包含这几个 H2,顺序一致:

```text
## Summary
## Use this package
## Understand the implementation
## Further Exploration
## Model Experience
## Known Limitations and Deferred Work
```

`## Model Experience` 是强制项,内容写本版为 "None, as the host half registers nothing model-facing yet";Phase 1 的后续任务会改写它——素材被编排成模型请求之后,这一节必须说明发送了什么、token 影响与 KV-cache 效果。

`## Known Limitations and Deferred Work` 本版至少写两条真实限制:面板 UI 尚未实现;附件一经落盘永不回收,删除 draft 素材会留下孤儿附件。

英文首行之下必须有语言切换行:

```text
English | [中文](README.zh.md)
```

- [ ] **Step 2: 写 `README.zh.md`**

中文版,首行之下:

```text
[English](README.md) | 中文
```

结构必须与英文版一一对应:标题深度与顺序、列表种类与条目数、表格行列数、代码块内容全部一致。`verify-translation-pairing` 会机械校验这些结构签名。

- [ ] **Step 3: 生成配对记录**

Run: `pnpm run verify-translation-pairing --write packages/notes/notes/README.md`

Expected: 生成 `README.i18n.yaml`,内容是两边的 git blob hash。

该命令要求先 `git add` 两个 README,否则记录的是空内容:

```bash
git add packages/notes/notes/README.md packages/notes/notes/README.zh.md
pnpm run verify-translation-pairing --write packages/notes/notes/README.md
```

- [ ] **Step 4: 校验配对**

Run: `pnpm run verify-translation-pairing packages/notes/notes/README.md`

Expected: 退出码 0。若报结构签名不匹配,逐项对齐中英两边的标题层级、列表条目数与代码块。

- [ ] **Step 5: 提交**

```bash
git add packages/notes/notes/README.md packages/notes/notes/README.zh.md packages/notes/notes/README.i18n.yaml
git commit -m "docs(notes): add the package README pair"
```

---

### Task 4: 存储域声明与打开

**Files:**
- Create: `packages/notes/notes/src/domain.ts`
- Modify: `packages/notes/notes/src/types.ts`
- Modify: `packages/notes/notes/src/index.ts`
- Modify: `packages/notes/notes/tsconfig.host.json`
- Test: `packages/notes/notes/tests/domain.host.spec.ts`

**Interfaces:**
- Consumes: `ctx.storageDomain`(`packages/storage/storage-domain`,由 `dsh-base` 挂载,本插件不需要加 cordis 行)。
- Produces:
  - `NOTES_TABLES = { materials: 'materials', sessions: 'sessions' }`
  - `notesDomainSpec: DomainSpec`,域名为 `notes`,版本 `1`
  - `NOTES_DOMAIN_NAME = 'notes'`

**关键约束:** 记录 schema 用 **zod**;`defineDomain` 在模块加载时校验域名与表名匹配 `/^[a-z][a-z0-9_]*$/`,不匹配立即抛。

- [ ] **Step 1: 写类型**

`src/types.ts` 追加:

```text
/**
 * Shared public types of the notes plugin.
 *
 * Identities are `Branded` from `@deepseek-ai/dsh-brand` rather than a
 * hand-rolled `string & { … }`: the repo brands every opaque cross-boundary id
 * through that one declaration.
 */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque id of one collected material. */
export type MaterialId = Branded<'material-id'>

/** Opaque id of one notes conversation. */
export type NoteSessionId = Branded<'note-session-id'>

/** How a material entered the notes. */
export type MaterialKind = 'text' | 'image'

/** Lifecycle of one material. */
export type MaterialStatus = 'draft' | 'analyzing' | 'analyzed' | 'failed'

/** Where a collected material came from. */
export interface MaterialSource {
  /** Session the text or image was collected from. */
  readonly sessionId: string
  /** `chat` or `trajectory`, as the collecting surface reported it. */
  readonly view: string
  /** Source event sequence, when the collecting surface resolved one. */
  readonly seq: number | null
  /** Durable message id, when the source was a conversation message. */
  readonly messageId: string | null
  /** Tool call id, when the source was a tool row. */
  readonly callId: string | null
  /** Display label, resolved and localized at collection time. */
  readonly label: string
}
```

- [ ] **Step 2: 写域声明**

`src/domain.ts`:

```text
/**
 * The notes domain: durable materials and notes conversations.
 *
 * The session log stays the content truth; this domain stores only the
 * submitted message ids and the collection metadata. A material's text and a
 * model's answer live in the session events, never here.
 * @module @deepseek-ai/dsh-notes/domain
 */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { MaterialId, MaterialStatus, NoteSessionId } from './types.ts'

/** Domain name; also the backend unit name. */
export const NOTES_DOMAIN_NAME = 'notes'

/** Current domain format version. */
export const NOTES_DOMAIN_VERSION = 1

// The durable boundary manufactures the brands: stored keys are plain strings
// and `brandString` is how every package turns one back into its opaque id.
const materialId = z.string().transform(value => brandString<MaterialId>(value))
const noteSessionId = z.string().transform(value => brandString<NoteSessionId>(value))

const materialSource = z.object({
  sessionId: z.string(),
  view: z.string(),
  seq: z.number().nullable(),
  messageId: z.string().nullable(),
  callId: z.string().nullable(),
  label: z.string(),
})

/**
 * One collected material. `text` carries the user's edited body while the
 * material is a draft; once it enters a session the log carries the body and
 * this field is the text as submitted. `image` is an attachment reference
 * string, never bytes.
 */
export const materialRecord = z.object({
  noteId: z.string(),
  kind: z.union([z.literal('text'), z.literal('image')]),
  text: z.string().nullable(),
  image: z.string().nullable(),
  source: materialSource,
  action: z.string().nullable(),
  order: z.number(),
  status: z.union([
    z.literal('draft'), z.literal('analyzing'), z.literal('analyzed'), z.literal('failed'),
  ]),
  messageIds: z.array(z.string()),
  error: z.string().nullable(),
  createdAt: z.number(),
  archivedAt: z.number().nullable(),
})

/** One stored material record. */
export type MaterialRecord = z.infer<typeof materialRecord>

/** One notes conversation: the plugin's record of a real dsh Session. */
export const noteSessionRecord = z.object({
  sessionId: z.string(),
  title: z.string(),
  createdAt: z.number(),
  archivedAt: z.number().nullable(),
})

/** One stored notes-conversation record. */
export type NoteSessionRecord = z.infer<typeof noteSessionRecord>

/** Current notes conversation, used before the first conversation exists. */
export const notesGlobal = z.object({
  activeNoteId: z.string().nullable(),
})

/** Stored global state of the notes domain. */
export type NotesGlobalState = z.infer<typeof notesGlobal>

/** The notes domain spec. */
export const notesDomainSpec = defineDomain({
  name: NOTES_DOMAIN_NAME,
  version: NOTES_DOMAIN_VERSION,
  global: { schema: notesGlobal, initial: { activeNoteId: null } },
  tables: {
    materials: domainTable<MaterialId, MaterialRecord>(materialRecord),
    sessions: domainTable<NoteSessionId, NoteSessionRecord>(noteSessionRecord),
  },
})
```

`domainTable<MaterialId, MaterialRecord>` 的两个类型参数分别是 key 与 value 的编译期投影;运行时 key 是普通字符串。

- [ ] **Step 3: 写测试(先红)**

`packages/notes/notes/tests/domain.host.spec.ts`:

```text
/**
 * The notes domain opens over a real storage stack, round-trips one material
 * record, and releases the name on close.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import StorageJson from '@deepseek-ai/dsh-storage-json'
import StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { afterEach, describe, expect, it } from 'vitest'
import { NOTES_DOMAIN_NAME, notesDomainSpec } from '../src/domain.ts'

let ctx: Context | undefined
let root: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function bench(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-notes-domain-'))
  const created = new Context()
  await created.plugin(Storage).await()
  await created.plugin(StorageJson, { root }).await()
  await created.plugin(StorageDomain, { backend: 'json' }).await()
  ctx = created
  return created
}

describe('notes domain', () => {
  it('opens, round-trips a material, and frees the name on close', async () => {
    const created = await bench()
    const domain = await created.storageDomain.open(notesDomainSpec)
    expect(domain.name).toBe(NOTES_DOMAIN_NAME)

    const table = domain.table('materials')
    await table.put('m1' as never, {
      noteId: 'n1', kind: 'text', text: 'hello', image: null,
      source: { sessionId: 's1', view: 'chat', seq: 7, messageId: 'm-7', callId: null, label: '会话《x》第 1 轮' },
      action: null, order: 0, status: 'draft', messageIds: [], error: null,
      createdAt: 1, archivedAt: null,
    })
    expect(table.get('m1' as never)?.text).toBe('hello')

    await domain.close()
    const reopened = await created.storageDomain.open(notesDomainSpec)
    expect(reopened.table('materials').get('m1' as never)?.text).toBe('hello')
    await reopened.close()
  })
})
```

- [ ] **Step 4: 跑测试确认红**

Run: `pnpm exec vitest run packages/notes/notes/tests/domain.host.spec.ts`

Expected: FAIL——`../src/domain.ts` 不存在。

- [ ] **Step 5: 把域挂进插件生命周期**

`src/domain.ts` 追加一个打开助手:

```text
/**
 * Open the notes domain and bind its lifetime to the caller's effect.
 * @param ctx - host context carrying the storage domain facility.
 * @returns the opened domain handle.
 */
export async function openNotesDomain(ctx: Context): Promise<Domain<typeof notesDomainSpec>> {
  const domain = await ctx.storageDomain.open(notesDomainSpec)
  ctx.effect(() => () => domain.close(), 'notes: domain close')
  return domain
}
```

`Context` 与 `Domain` 的类型 import 加到文件头部:

```text
import type { Context } from '@deepseek-ai/cordis'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
```

- [ ] **Step 6: 把 `src/domain.ts` 加进 host tsconfig**

`tsconfig.host.json` 的 `files` 数组改为:

```text
  "files": ["src/domain.ts", "src/index.ts", "src/types.ts"],
```

- [ ] **Step 7: 跑测试与 typecheck**

Run: `pnpm exec vitest run packages/notes/notes/tests/domain.host.spec.ts && pnpm exec tsc -b packages/notes/notes/tsconfig.host.json`

Expected: 两者都退出码 0。

- [ ] **Step 8: 提交**

```bash
git add packages/notes/notes
git commit -m "feat(notes): add the notes storage domain"
```

---

### Task 5: 素材表的读写与排序

**Files:**
- Create: `packages/notes/notes/src/materials.ts`
- Modify: `packages/notes/notes/src/index.ts`
- Modify: `packages/notes/notes/tsconfig.host.json`
- Test: `packages/notes/notes/tests/materials.host.spec.ts`

**Interfaces:**
- Consumes: Task 4 的 `notesDomainSpec`、`MaterialRecord`、`MaterialId`。
- Produces: `class Materials`(服务键 `notesMaterials`),方法签名:
  - `list(noteId: string): MaterialRecord & { id: MaterialId }[]` —— 未归档在前,按 `order` 升序
  - `get(id: MaterialId): (MaterialRecord & { id: MaterialId }) | undefined` —— 按键取一条
  - `archived(noteId: string): (MaterialRecord & { id: MaterialId })[]`
  - `create(record: MaterialRecord): Promise<MaterialId>`
  - `update(id: MaterialId, fn: (current: MaterialRecord) => MaterialRecord): Promise<MaterialRecord>`
  - `archive(id: MaterialId): Promise<void>`
  - `restore(id: MaterialId): Promise<void>` —— 取出并置顶
  - `reorder(noteId: string, orderedIds: readonly MaterialId[]): Promise<void>`
  - `remove(id: MaterialId): Promise<void>`

- [ ] **Step 1: 写测试(先红)**

`packages/notes/notes/tests/materials.host.spec.ts`:

```text
/**
 * Material ordering, archiving, and restore-to-top over the real domain.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import StorageJson from '@deepseek-ai/dsh-storage-json'
import StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Materials } from '../src/materials.ts'
import type { MaterialId } from '../src/types.ts'

let ctx: Context | undefined
let root: string | undefined
let materials: Materials

/** Source stamp reused by every fixture material. */
const source = { sessionId: 's1', view: 'chat', seq: 1, messageId: null, callId: null, label: 'l' }

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-notes-materials-'))
  ctx = new Context()
  await ctx.plugin(Storage).await()
  await ctx.plugin(StorageJson, { root }).await()
  await ctx.plugin(StorageDomain, { backend: 'json' }).await()
  materials = new Materials(ctx)
  await materials.ready()
})

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await rm(root!, { recursive: true, force: true })
})

/** Create one draft material in the given note. */
async function seed(noteId: string, text: string): Promise<MaterialId> {
  return materials.create({
    noteId, kind: 'text', text, image: null, source, action: null,
    order: 0, status: 'draft', messageIds: [], error: null, createdAt: 0, archivedAt: null,
  })
}

describe('notes materials', () => {
  it('lists newest first by insertion order then respects an explicit reorder', async () => {
    const a = await seed('n1', 'a')
    const b = await seed('n1', 'b')
    const c = await seed('n1', 'c')
    expect(materials.list('n1').map(m => m.text)).toEqual(['c', 'b', 'a'])

    await materials.reorder('n1', [a, c, b])
    expect(materials.list('n1').map(m => m.text)).toEqual(['a', 'c', 'b'])
  })

  it('archives out of the list and restores to the top', async () => {
    const a = await seed('n1', 'a')
    await seed('n1', 'b')
    await materials.archive(a)
    expect(materials.list('n1').map(m => m.text)).toEqual(['b'])
    expect(materials.archived('n1').map(m => m.text)).toEqual(['a'])

    await materials.restore(a)
    expect(materials.list('n1').map(m => m.text)).toEqual(['a', 'b'])
    expect(materials.archived('n1')).toEqual([])
  })

  it('scopes every read to one note', async () => {
    await seed('n1', 'a')
    await seed('n2', 'b')
    expect(materials.list('n1').map(m => m.text)).toEqual(['a'])
    expect(materials.list('n2').map(m => m.text)).toEqual(['b'])
  })

  it('reads one material by id, and reports an absent one', async () => {
    const a = await seed('n1', 'a')
    expect(materials.get(a)?.text).toBe('a')
    expect(materials.get('nope' as never)).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm exec vitest run packages/notes/notes/tests/materials.host.spec.ts`

Expected: FAIL——`../src/materials.ts` 不存在。

- [ ] **Step 3: 写 `src/materials.ts`**

```text
/**
 * Material storage: creation, ordering, archiving, and restore-to-top.
 *
 * Ordering is an explicit integer per material, rewritten wholesale by
 * `reorder`. Newest lands at the top because `create` mints the lowest order
 * in the note, so a fresh material needs no renumbering pass.
 * @module @deepseek-ai/dsh-notes/materials
 */

import { randomUUID } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { notesDomainSpec, openNotesDomain } from './domain.ts'
import type { MaterialRecord } from './domain.ts'
import type { MaterialId } from './types.ts'

/** A stored material together with its id. */
export type StoredMaterial = MaterialRecord & { readonly id: MaterialId }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable material storage for the notes panel. */
    notesMaterials: Materials
  }
}

/** Durable material storage. */
export class Materials extends Service {
  static inject = ['storageDomain']

  private domain?: Domain<typeof notesDomainSpec>

  /** @param ctx - host context carrying the storage domain facility. */
  constructor(ctx: Context) {
    super(ctx, 'notesMaterials')
  }

  /** Open the domain; awaited by tests and by the plugin's init. */
  async ready(): Promise<void> {
    if (this.domain !== undefined) return
    this.domain = await openNotesDomain(this.ctx)
  }

  /**
   * Open the domain as part of activation, so a mounted plugin is usable
   * without any caller awaiting `ready()` first.
   */
  protected async [Service.init](): Promise<void> {
    await this.ready()
  }

  private table() {
    if (this.domain === undefined) throw new Error('notes: materials used before ready()')
    return this.domain.table('materials')
  }

  /**
   * Unarchived materials of one note, bottom-most order last.
   * @param noteId - notes conversation id.
   * @returns ordered stored materials.
   */
  list(noteId: string): StoredMaterial[] {
    return this.collect(noteId, null)
  }

  /**
   * Archived materials of one note, most recently archived first.
   * @param noteId - notes conversation id.
   * @returns ordered stored materials.
   */
  archived(noteId: string): StoredMaterial[] {
    return this.collect(noteId, 'archived')
  }

  private collect(noteId: string, bucket: 'archived' | null): StoredMaterial[] {
    const rows: StoredMaterial[] = []
    for (const [id, record] of this.table().entries()) {
      if (record.noteId !== noteId) continue
      if (bucket === null ? record.archivedAt !== null : record.archivedAt === null) continue
      rows.push({ ...record, id })
    }
    return rows.sort((left, right) => bucket === null
      ? left.order - right.order || left.createdAt - right.createdAt
      : (right.archivedAt ?? 0) - (left.archivedAt ?? 0))
  }

  /**
   * Store one material at the top of its note.
   * @param record - the complete material record.
   * @returns the minted material id.
   */
  async create(record: MaterialRecord): Promise<MaterialId> {
    const id = brandString<MaterialId>(randomUUID())
    const top = this.list(record.noteId)
    const order = top.length === 0 ? 0 : Math.min(...top.map(row => row.order)) - 1
    await this.table().put(id, { ...record, order })
    return id
  }

  /**
   * Read one material by id.
   * @param id - material id.
   * @returns the stored material, or undefined when absent.
   */
  get(id: MaterialId): StoredMaterial | undefined {
    const record = this.table().get(id)
    return record === undefined ? undefined : { ...record, id }
  }

  /**
   * Replace one material atomically.
   * @param id - material id.
   * @param fn - pure transform from the current record to the next.
   * @returns the stored next record.
   */
  async update(id: MaterialId, fn: (current: MaterialRecord) => MaterialRecord): Promise<MaterialRecord> {
    return this.table().update(id, fn)
  }

  /**
   * Move one material to the archived bucket.
   * @param id - material id.
   */
  async archive(id: MaterialId): Promise<void> {
    await this.update(id, current => ({ ...current, archivedAt: Date.now() }))
  }

  /**
   * Return one material to the top of its note.
   * @param id - material id.
   */
  async restore(id: MaterialId): Promise<void> {
    const current = this.table().get(id)
    if (current === undefined) return
    const top = this.list(current.noteId)
    const order = top.length === 0 ? 0 : Math.min(...top.map(row => row.order)) - 1
    await this.update(id, record => ({ ...record, archivedAt: null, order }))
  }

  /**
   * Apply a complete manual ordering to one note.
   * @param noteId - notes conversation id.
   * @param orderedIds - every visible material of the note, top first.
   */
  async reorder(noteId: string, orderedIds: readonly MaterialId[]): Promise<void> {
    const known = new Set(this.list(noteId).map(row => row.id))
    for (const id of orderedIds) if (!known.has(id)) throw new Error(`notes: unknown material ${id}`)
    for (const [index, id] of orderedIds.entries()) {
      await this.update(id, record => ({ ...record, order: index }))
    }
  }

  /**
   * Delete one material record.
   * @param id - material id.
   */
  async remove(id: MaterialId): Promise<void> {
    await this.table().delete(id)
  }
}

export default Materials
```

- [ ] **Step 4: 把服务挂进插件并加进 tsconfig**

`src/index.ts` 改为:

```text
/** Services the host half needs. */
export const inject: string[] = []

/**
 * Host plugin body: open the durable material store.
 * @param ctx - host context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(Materials)
}
```

并加 import:

```text
import { Materials } from './materials.ts'
```

`tsconfig.host.json` 的 `files` 改为:

```text
  "files": ["src/domain.ts", "src/index.ts", "src/materials.ts", "src/types.ts"],
```

- [ ] **Step 5: 跑测试**

Run: `pnpm exec vitest run packages/notes/notes/tests/materials.host.spec.ts`

Expected: PASS(三个用例)。

- [ ] **Step 6: 提升覆盖率到 100%**

Run: `pnpm exec vitest run --coverage packages/notes/notes/tests/materials.host.spec.ts`

Expected: `src/materials.ts` 与 `src/domain.ts` 逐文件 100%。未覆盖的分支补用例——`ready()` 的重复调用、`restore` 对不存在 id、`reorder` 的未知 id 抛错,各补一条。

- [ ] **Step 7: 提交**

```bash
git add packages/notes/notes
git commit -m "feat(notes): add durable material storage"
```

---

### Task 6: 笔记会话记录

**Files:**
- Create: `packages/notes/notes/src/note-sessions.ts`
- Modify: `packages/notes/notes/src/index.ts`
- Modify: `packages/notes/notes/tsconfig.host.json`
- Test: `packages/notes/notes/tests/note-sessions.host.spec.ts`

**Interfaces:**
- Consumes: Task 4 的域、Task 5 的 `Materials` 服务形态。
- Produces: `class NoteSessions`(服务键 `notesSessions`),方法:
  - `list(): NoteSessionRecord & { id: NoteSessionId }[]` —— 未归档,新的在前
  - `archived(): (NoteSessionRecord & { id: NoteSessionId })[]`
  - `record(record: NoteSessionRecord): Promise<NoteSessionId>`
  - `archive(id: NoteSessionId): Promise<void>`
  - `restore(id: NoteSessionId): Promise<void>`
  - `active(): NoteSessionId | null` / `setActive(id: NoteSessionId | null): Promise<void>`

- [ ] **Step 1: 写测试(先红)**

`packages/notes/notes/tests/note-sessions.host.spec.ts`:

```text
/**
 * Notes conversations: creation, archiving, restore-to-top, and the active
 * pointer that survives a reopen.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import StorageJson from '@deepseek-ai/dsh-storage-json'
import StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NoteSessions } from '../src/note-sessions.ts'

let ctx: Context | undefined
let root: string | undefined
let sessions: NoteSessions

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-notes-sessions-'))
  ctx = new Context()
  await ctx.plugin(Storage).await()
  await ctx.plugin(StorageJson, { root }).await()
  await ctx.plugin(StorageDomain, { backend: 'json' }).await()
  sessions = new NoteSessions(ctx)
  await sessions.ready()
})

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await rm(root!, { recursive: true, force: true })
})

describe('notes conversations', () => {
  it('records a conversation, makes it active, and archives it out of the list', async () => {
    const first = await sessions.record({ sessionId: 's1', title: '笔记 · A', createdAt: 1, archivedAt: null })
    await sessions.setActive(first)
    expect(sessions.active()).toBe(first)
    expect(sessions.list().map(row => row.title)).toEqual(['笔记 · A'])

    await sessions.archive(first)
    expect(sessions.list()).toEqual([])
    expect(sessions.archived().map(row => row.title)).toEqual(['笔记 · A'])
  })

  it('restores an archived conversation to the top and makes it active again', async () => {
    const first = await sessions.record({ sessionId: 's1', title: 'A', createdAt: 1, archivedAt: null })
    const second = await sessions.record({ sessionId: 's2', title: 'B', createdAt: 2, archivedAt: null })
    await sessions.archive(first)
    await sessions.restore(first)

    expect(sessions.list().map(row => row.title)).toEqual(['A', 'B'])
    expect(sessions.active()).toBe(first)
    expect(second).not.toBe(first)
  })
})
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm exec vitest run packages/notes/notes/tests/note-sessions.host.spec.ts`

Expected: FAIL——`../src/note-sessions.ts` 不存在。

- [ ] **Step 3: 写 `src/note-sessions.ts`**

```text
/**
 * Notes conversations: one record per real dsh Session the panel drives.
 *
 * The dsh Session is the truth; this record adds only what the panel needs —
 * a title, when it was created, and whether it is archived. The active
 * pointer lives in the domain global so a restart restores the same panel.
 * @module @deepseek-ai/dsh-notes/note-sessions
 */

import { randomUUID } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { notesDomainSpec, openNotesDomain } from './domain.ts'
import type { NoteSessionRecord } from './domain.ts'
import type { NoteSessionId } from './types.ts'

/** A stored notes conversation together with its id. */
export type StoredNoteSession = NoteSessionRecord & { readonly id: NoteSessionId }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable notes-conversation records. */
    notesSessions: NoteSessions
  }
}

/** Durable notes-conversation records. */
export class NoteSessions extends Service {
  static inject = ['storageDomain']

  private domain?: Domain<typeof notesDomainSpec>

  /** @param ctx - host context carrying the storage domain facility. */
  constructor(ctx: Context) {
    super(ctx, 'notesSessions')
  }

  /** Open the domain; awaited by tests and by the plugin's init. */
  async ready(): Promise<void> {
    if (this.domain !== undefined) return
    this.domain = await openNotesDomain(this.ctx)
  }

  /**
   * Open the domain as part of activation, so a mounted plugin is usable
   * without any caller awaiting `ready()` first.
   */
  protected async [Service.init](): Promise<void> {
    await this.ready()
  }

  private table() {
    if (this.domain === undefined) throw new Error('notes: sessions used before ready()')
    return this.domain.table('sessions')
  }

  /**
   * Unarchived conversations, newest first.
   * @returns ordered stored conversations.
   */
  list(): StoredNoteSession[] {
    return this.collect(null)
  }

  /**
   * Archived conversations, most recently archived first.
   * @returns ordered stored conversations.
   */
  archived(): StoredNoteSession[] {
    return this.collect('archived')
  }

  private collect(bucket: 'archived' | null): StoredNoteSession[] {
    const rows: StoredNoteSession[] = []
    for (const [id, record] of this.table().entries()) {
      if (bucket === null ? record.archivedAt !== null : record.archivedAt === null) continue
      rows.push({ ...record, id })
    }
    return rows.sort((left, right) => bucket === null
      ? right.createdAt - left.createdAt
      : (right.archivedAt ?? 0) - (left.archivedAt ?? 0))
  }

  /**
   * Record one notes conversation and make it active.
   * @param record - the complete record.
   * @returns the minted conversation id.
   */
  async record(record: NoteSessionRecord): Promise<NoteSessionId> {
    const id = brandString<NoteSessionId>(randomUUID())
    await this.table().put(id, record)
    await this.setActive(id)
    return id
  }

  /**
   * Move one conversation to the archived bucket, clearing the active pointer
   * when it pointed there.
   * @param id - conversation id.
   */
  async archive(id: NoteSessionId): Promise<void> {
    await this.table().update(id, record => ({ ...record, archivedAt: Date.now() }))
    if (this.active() === id) {
      const next = this.list()[0]
      await this.setActive(next?.id ?? null)
    }
  }

  /**
   * Return one archived conversation to the top and make it active.
   * @param id - conversation id.
   */
  async restore(id: NoteSessionId): Promise<void> {
    await this.table().update(id, record => ({ ...record, archivedAt: null }))
    await this.setActive(id)
  }

  /**
   * Read the active conversation.
   * @returns the active conversation id, or null when none exists.
   */
  active(): NoteSessionId | null {
    const stored = this.domain?.global.get().activeNoteId
    return stored === undefined || stored === null ? null : brandString<NoteSessionId>(stored)
  }

  /**
   * Point the panel at one conversation.
   * @param id - conversation id, or null for none.
   */
  async setActive(id: NoteSessionId | null): Promise<void> {
    if (this.domain === undefined) throw new Error('notes: sessions used before ready()')
    await this.domain.global.set({ activeNoteId: id })
  }
}

export default NoteSessions
```

- [ ] **Step 4: 挂服务、加 tsconfig、跑测试**

`src/index.ts` 的 `apply` 追加 `ctx.plugin(NoteSessions)`,并把 `src/note-sessions.ts` 加进 `tsconfig.host.json` 的 `files`。

Run: `pnpm exec vitest run packages/notes/notes/tests/note-sessions.host.spec.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/notes/notes
git commit -m "feat(notes): record notes conversations"
```

---

### Task 7: 线程归属计算

**Files:**
- Create: `packages/notes/notes/src/thread.ts`
- Modify: `packages/notes/notes/tsconfig.host.json`
- Test: `packages/notes/notes/tests/thread.host.spec.ts`

**Interfaces:**
- Consumes: 会话事件的最小形状(只读 `seq`、`type`,以及 `user/message` 载荷里的 `id`)。
- Produces: `attributeThread(events, messageIds)` —— 纯函数,无 Cordis 依赖。

**这是本设计里唯一需要精确表述的规则,必须先写测试再写实现。**

规则:一条素材的线程 = 该素材每条 user message(**其 `id` 属于 `messageIds`**)及其之后、下一条 user message 之前的全部事件。

**为什么按 id 而不是按 seq 匹配:** `Agent.followup(message)` 的签名是 `followup(message: UserMessage): void`,不返回回执,调用方拿不到消息落进日志后的 seq。而 `createUserMessage()` 在发送前就返回带稳定 `id` 的消息,id 同步可得。`user/message` 事件的 `data` 就是 `UserMessage` 本身(`packages/core/session/src/types.ts:297`),所以 `event.data.id` 即消息 id。

- [ ] **Step 1: 写测试(先红)**

`packages/notes/notes/tests/thread.host.spec.ts`:

```text
/**
 * Thread attribution. A material's thread is each of its own user messages plus
 * everything up to the next user message, so a follow-up asked long after the
 * first analysis still lands in the right thread.
 */
import { describe, expect, it } from 'vitest'
import { attributeThread } from '../src/thread.ts'

/** Minimal event shape the attribution reads; `data.id` mirrors `UserMessage.id`. */
interface Row {
  readonly seq: number
  readonly type: string
  readonly data?: { readonly id?: string }
}

const rows: Row[] = [
  { seq: 10, type: 'user/message', data: { id: 'a1' } },   // material A
  { seq: 11, type: 'assistant/message' },
  { seq: 20, type: 'user/message', data: { id: 'b1' } },   // material B
  { seq: 21, type: 'assistant/message' },
  { seq: 30, type: 'user/message', data: { id: 'a2' } },   // A follow-up, after B
  { seq: 31, type: 'tool/call' },
  { seq: 32, type: 'assistant/message' },
  { seq: 40, type: 'user/message', data: { id: 'b2' } },   // B follow-up
  { seq: 41, type: 'assistant/message' },
]

describe('thread attribution', () => {
  it('keeps every non-contiguous segment belonging to one material', () => {
    expect(attributeThread(rows, ['a1', 'a2']).map(row => row.seq)).toEqual([10, 11, 30, 31, 32])
  })

  it('never leaks a neighbouring material into the thread', () => {
    expect(attributeThread(rows, ['b1']).map(row => row.seq)).toEqual([20, 21])
    expect(attributeThread(rows, ['b2']).map(row => row.seq)).toEqual([40, 41])
  })

  it('returns nothing for a material that never entered the session', () => {
    expect(attributeThread(rows, [])).toEqual([])
    expect(attributeThread(rows, ['never-sent'])).toEqual([])
  })

  it('stops at a user message carrying no identity, without attributing it', () => {
    const blank: Row[] = [{ seq: 50, type: 'user/message' }, { seq: 51, type: 'assistant/message' }]
    expect(attributeThread([...rows, ...blank], ['a1']).map(row => row.seq)).toEqual([10, 11])
  })
})
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm exec vitest run packages/notes/notes/tests/thread.host.spec.ts`

Expected: FAIL——`../src/thread.ts` 不存在。

- [ ] **Step 3: 写 `src/thread.ts`**

```text
/**
 * Thread attribution: which session events belong to one material.
 *
 * Attribution is explicit, never positional. A follow-up may arrive long after
 * the material's first analysis and after other materials were analysed, so a
 * contiguous range would steal a neighbour's events. The material records the
 * ids of its own user messages; this function takes, for each, the events up to
 * the next user message.
 *
 * Identity is matched, not sequence: `Agent.followup()` returns void, so the
 * sequence a message lands on is not knowable when it is sent, while its id is
 * known before the send.
 * @module @deepseek-ai/dsh-notes/thread
 */

/** The minimum an event must expose to be attributed. */
export interface AttributedRow {
  /** Monotonic sequence within the session. */
  readonly seq: number
  /** Session event type. */
  readonly type: string
  /** Session event payload; a `user/message` payload is a `UserMessage` carrying `id`. */
  readonly data?: { readonly id?: string }
}

/**
 * Events belonging to one material.
 * @param events - the session's events in sequence order.
 * @param messageIds - ids of this material's own user messages.
 * @returns the attributed events in sequence order.
 */
export function attributeThread<T extends AttributedRow>(
  events: readonly T[],
  messageIds: readonly string[],
): T[] {
  const owned = new Set(messageIds)
  if (owned.size === 0) return []
  const ordered = [...events].sort((left, right) => left.seq - right.seq)
  const thread: T[] = []
  let collecting = false
  for (const event of ordered) {
    if (event.type === 'user/message') collecting = owns(event, owned)
    if (collecting) thread.push(event)
  }
  return thread
}

/**
 * Whether one user/message event is one of the material's own.
 * @param event - the candidate event.
 * @param owned - the material's message ids.
 * @returns true when the event carries one of those ids.
 */
function owns(event: AttributedRow, owned: ReadonlySet<string>): boolean {
  const id = event.data?.id
  return id !== undefined && owned.has(id)
}
```

- [ ] **Step 4: 跑测试与覆盖率**

Run: `pnpm exec vitest run --coverage packages/notes/notes/tests/thread.host.spec.ts`

Expected: PASS 且 `src/thread.ts` 100%。

- [ ] **Step 5: 提交**

```bash
git add packages/notes/notes
git commit -m "feat(notes): attribute session events to a material"
```

---

### Task 8: 设置命名空间

**Files:**
- Create: `packages/notes/notes/src/settings.ts`
- Modify: `packages/notes/notes/src/index.ts`
- Modify: `packages/notes/notes/tsconfig.host.json`
- Modify: `packages/notes/notes/tests/node-plugin.host.spec.ts`(Task 2 建的;本任务改了 `apply` 的签名,必须同步)
- Test: `packages/notes/notes/tests/settings.host.spec.ts`

**Interfaces:**
- Consumes: `ctx.settings.installSection`。
- Produces: `NOTES_SETTINGS_NAMESPACE = 'notes'`、`Config`(插件的 cordis 行 config,同时是设置的 base 层,并由 `src/index.ts` 再导出)、`class NotesSettings`(服务键 `notesSettings`),方法 `strategy(): 'manual' | 'auto'`、`actions(): ActionDef[]`、`workspace(): string | null`、`model(): { provider: string; model: string } | null`。

**关键约束:** 设置 schema 用 **schemastery**(`import s from '@deepseek-ai/schemastery'`),不是 zod。

**本任务会打破 Task 2 的测试,必须一并修。** Task 2 的 `tests/node-plugin.host.spec.ts` 用 `ctx.plugin({ apply, inject })` 挂载,而 Cordis 会对它调用 `apply(ctx, undefined)`。Step 4 把 `apply` 改成 `(ctx, config: Config)` 之后,`undefined` 会一路传进 `NotesSettings`,读取时抛错。修法是把那个测试改成带显式 `Config` 挂载——它要证明的事(行能被解析、能干净卸载)完全不变,只是多一个参数。

- [ ] **Step 1: 写测试(先红)**

`packages/notes/notes/tests/settings.host.spec.ts`:

```text
/**
 * The notes settings section: defaults resolve from the composition entry, and
 * a user write through the settings provider is what the owner then reads.
 */
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { afterEach, describe, expect, it } from 'vitest'
import { NOTES_SETTINGS_NAMESPACE, NotesSettings } from '../src/settings.ts'

/**
 * Minimal in-memory provider. `@deepseek-ai/dsh-settings` exports the abstract
 * `SettingsProvider`, which cannot be mounted itself, and its own `tests/`
 * directory is not part of the package's `exports`, so every consumer package
 * declares its own — the same shape the repo's other settings specs use.
 */
class MemorySettings extends SettingsProvider {
  private doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

/** Mount a provider and the notes settings service over one context. */
async function bench(): Promise<NotesSettings> {
  ctx = new Context()
  await ctx.plugin(MemorySettings).await()
  const settings = NotesSettings
  const fiber = ctx.plugin(settings, { strategy: 'manual', actions: [], workspace: null, model: null })
  await fiber.await()
  return ctx.notesSettings
}

describe('notes settings', () => {
  it('resolves the composition entry as the base and serves the owner reads', async () => {
    const notes = await bench()
    expect(notes.strategy()).toBe('manual')
    expect(notes.workspace()).toBeNull()
    expect(ctx!.settings.get(NOTES_SETTINGS_NAMESPACE)).toMatchObject({ strategy: 'manual' })
  })

  it('reflects a user write', async () => {
    const notes = await bench()
    await ctx!.settings.update(NOTES_SETTINGS_NAMESPACE, { strategy: 'auto' })
    expect(notes.strategy()).toBe('auto')
  })

  it('ships the translate action as the composition default', async () => {
    const notes = await bench()
    expect(notes.actions().map(action => action.id)).toEqual(['translate'])
    expect(notes.actions()[0]?.prompt).toBe('不改变语句结构，翻译下列内容：')
    expect(notes.actions()[0]?.autoSend).toBe(true)
  })
})
```

第三条用例断言的是**经 schema 解析后的默认值**,比去读 `Config` 对象上的内部字段可靠——schemastery 的默认值读取 API 是实现细节,不要依赖。

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm exec vitest run packages/notes/notes/tests/settings.host.spec.ts`

Expected: FAIL——`../src/settings.ts` 不存在。

- [ ] **Step 3: 写 `src/settings.ts`**

```text
/**
 * The notes settings section and the host owner that reads it.
 *
 * Every deployment-varying choice lives here rather than in a constant: the
 * model-call strategy, the prompt template of each collection action, the
 * workspace, and the optional model override. The composition entry is the
 * base layer, so a cordis row can ship defaults without code.
 * @module @deepseek-ai/dsh-notes/settings
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'

/** Settings namespace owned by this plugin. */
export const NOTES_SETTINGS_NAMESPACE = 'notes'

/** One collection action: the bubble entry and the prompt it prepends. */
export interface ActionDef {
  /** Stable action id, used as the material's `action` value. */
  readonly id: string
  /** Localized label shown in the selection bubble. */
  readonly label: string
  /** Prompt text prepended to the material body before submission. */
  readonly prompt: string
  /** Whether picking the action analyses immediately, ignoring the strategy. */
  readonly autoSend: boolean
}

/** When a newly collected material is sent to the model. */
export type NotesStrategy = 'manual' | 'auto'

/** Composition entry, also the settings base layer. */
export interface Config {
  /** `manual` waits for an explicit analyse; `auto` analyses on collection. */
  readonly strategy: NotesStrategy
  /** Collection actions offered by the selection bubble. */
  readonly actions: readonly ActionDef[]
  /** Absolute workspace path for notes conversations, or null before setup. */
  readonly workspace: string | null
  /** Model override for notes conversations, or null to follow the session default. */
  readonly model: { readonly provider: string; readonly model: string } | null
}

const actionSchema: s<ActionDef> = s.object({
  id: s.string().required(),
  label: s.string().required(),
  prompt: s.string().required(),
  autoSend: s.boolean().default(false),
})

/** Loader validation for the notes cordis row and its settings section. */
export const Config: s<Config> = s.object({
  strategy: s.union(['manual', 'auto'] as const).default('manual'),
  actions: s.array(actionSchema).default([
    {
      id: 'translate',
      label: '翻译',
      prompt: '不改变语句结构，翻译下列内容：',
      autoSend: true,
    },
  ]),
  workspace: s.string().default(null as never),
  model: s.object({ provider: s.string().required(), model: s.string().required() }).default(null as never),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Live notes settings. */
    notesSettings: NotesSettings
  }
}

/** Reads the notes settings section for the plugin's own consumers. */
export class NotesSettings extends Service {
  private source: () => Config

  /**
   * @param ctx - host context.
   * @param entry - the plugin's composition entry, used as the base layer.
   */
  constructor(ctx: Context, entry: Config) {
    super(ctx, 'notesSettings')
    this.source = () => entry
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, NOTES_SETTINGS_NAMESPACE, Config, entry, {
        setSource: (source) => { this.source = source },
        onChange: () => {},
      })
    })
  }

  /**
   * Current model-call strategy.
   * @returns `manual` or `auto`.
   */
  strategy(): NotesStrategy {
    return this.source().strategy
  }

  /**
   * Collection actions the bubble offers.
   * @returns the configured actions.
   */
  actions(): readonly ActionDef[] {
    return this.source().actions
  }

  /**
   * Configured workspace path.
   * @returns the absolute path, or null before first-run setup.
   */
  workspace(): string | null {
    return this.source().workspace
  }

  /**
   * Configured model override.
   * @returns provider and model, or null to follow the session default.
   */
  model(): { provider: string; model: string } | null {
    return this.source().model
  }
}

export default NotesSettings
```

`s.string().default(null as never)` 的写法是为让 schemastery 接受可空字符串;若该库有 `s.string().nullable()` 形式,改用它——以实际 API 为准。

**注意这个类没有 `static inject`。** 设置服务的缺席必须只是"退回组合入口的值",而不是让服务永远停在 PENDING——所以可选依赖走构造器里的 `ctx.inject(['settings'], ...)`(与 `packages/llm/llm-deepseek/src/index.ts:506` 同一写法),不要写成 `static inject = ['settings']`。

- [ ] **Step 4: 挂进插件并跑测试**

`apply` 改为接收 config 并挂服务:

```text
/** Services the host half needs. */
export const inject: string[] = []

/** The row's config schema, so the Loader validates and defaults it. */
export { Config } from './settings.ts'

/**
 * Host plugin body.
 * @param ctx - host context.
 * @param config - the row's validated composition entry.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(Materials)
  ctx.plugin(NoteSessions)
  ctx.plugin(NotesSettings, config)
}
```

**`Config` 的再导出不是可选项。** Loader 校验 cordis 行的 config 时读的是**模块命名空间的 `Config` 导出**;只在 `settings.ts` 里导出它,行就拿不到 schema,`config` 会是 `undefined`,设置节也永远拿不到默认值——Task 10 的组合测试夹具正是一行不带 `config` 的 `notes` 行。

**同时把 `tests/node-plugin.host.spec.ts` 改成带配置挂载:**

```text
    const mounted = ctx.plugin({ apply, inject }, {
      strategy: 'manual', actions: [], workspace: null, model: null,
    })
```

其余断言不动。

**两个容易写错的地方。** 其一,`ctx.plugin()` 接收的是**类或其配置**,不是实例——写 `ctx.plugin(new NotesSettings(ctx, config))` 在 Cordis 里是无效的,第二个参数才是传给构造函数的配置。其二,`SettingsProvider` 是 **abstract**,不能直接 `ctx.plugin(SettingsProvider)`;测试里必须自己声明一个内存实现(见 Step 1 的 `MemorySettings`)。

并把 `src/settings.ts` 加进 `tsconfig.host.json` 的 `files`。

Run: `pnpm exec vitest run packages/notes/notes/tests/settings.host.spec.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/notes/notes
git commit -m "feat(notes): serve the notes settings section"
```

---

### Task 9: 分析编排(素材 → 模型请求)

**Files:**
- Create: `packages/notes/notes/src/analysis.ts`
- Create: `packages/notes/notes/src/compose.ts`
- Modify: `packages/notes/notes/src/index.ts`
- Modify: `packages/notes/notes/tsconfig.host.json`
- Test: `packages/notes/notes/tests/compose.host.spec.ts`
- Test: `packages/notes/notes/tests/analysis.host.spec.ts`

**Interfaces:**
- Consumes: Task 5 的 `Materials`、Task 8 的 `NotesSettings`、`ctx.agents`、`createUserMessage`。
- Produces:
  - `composeBody(material: MaterialRecord): string` —— 纯函数,动作模板前置
  - `class Analysis`(服务键 `notesAnalysis`),方法:
    - `analyse(id: MaterialId): Promise<void>`
    - `ask(id: MaterialId, question: string): Promise<void>`

**关于两种策略的机制:** 两条路径都走 `agent.followup()`。`agent.inject()` 不适用——它把内容停在 inbox,等下一个消息合并进**同一次**请求,与"各答各的"冲突。差别只在触发时机:策略 `auto` 在收集时自动触发,`manual` 等用户点「分析」。动作带 `autoSend: true`(如翻译)时无条件触发。

- [ ] **Step 1: 先写纯函数的测试(先红)**

`packages/notes/notes/tests/compose.host.spec.ts`:

```text
/**
 * Body composition: an action prepends its prompt template to the material.
 */
import { describe, expect, it } from 'vitest'
import { composeBody } from '../src/compose.ts'
import type { MaterialRecord } from '../src/domain.ts'

/** Minimal material fixture; only the fields composeBody reads are meaningful. */
function material(overrides: Partial<MaterialRecord>): MaterialRecord {
  return {
    noteId: 'n1', kind: 'text', text: 'body', image: null,
    source: { sessionId: 's1', view: 'chat', seq: 1, messageId: null, callId: null, label: 'l' },
    action: null, order: 0, status: 'draft', messageIds: [], error: null,
    createdAt: 0, archivedAt: null,
    ...overrides,
  }
}

describe('body composition', () => {
  it('returns the material text unchanged without an action', () => {
    expect(composeBody(material({}), [])).toBe('body')
  })

  it('prepends the action prompt template', () => {
    const actions = [{ id: 'translate', label: '翻译', prompt: '不改变语句结构，翻译下列内容：', autoSend: true }]
    expect(composeBody(material({ action: 'translate' }), actions))
      .toBe('不改变语句结构，翻译下列内容：\nbody')
  })

  it('throws for an action that is no longer configured', () => {
    expect(() => composeBody(material({ action: 'gone' }), [])).toThrow(/unknown action/)
  })
})
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm exec vitest run packages/notes/notes/tests/compose.host.spec.ts`

Expected: FAIL——`../src/compose.ts` 不存在。

- [ ] **Step 3: 写 `src/compose.ts`**

```text
/**
 * Composing the text a material submits.
 *
 * An action contributes a prompt template prepended to the body on its own
 * line. The template is configuration, never a constant, so a deployment can
 * change what "translate" asks for without a code change.
 * @module @deepseek-ai/dsh-notes/compose
 */

import type { MaterialRecord } from './domain.ts'
import type { ActionDef } from './settings.ts'

/**
 * The text one material submits.
 * @param material - the stored material.
 * @param actions - currently configured actions.
 * @returns the body, with the action's prompt template prepended when set.
 * @throws {Error} when the material names an action that is not configured.
 */
export function composeBody(material: MaterialRecord, actions: readonly ActionDef[]): string {
  const body = material.text ?? ''
  if (material.action === null) return body
  const action = actions.find(candidate => candidate.id === material.action)
  if (action === undefined) throw new Error(`notes: unknown action "${material.action}"`)
  return `${action.prompt}\n${body}`
}
```

- [ ] **Step 4: 写分析编排的测试(先红)**

`packages/notes/notes/tests/analysis.host.spec.ts`:

```text
/**
 * Analysis orchestration: one material becomes one user message on the notes
 * conversation, the submitted message id is recorded, and the status walks
 * draft -> analyzing -> analyzed (or -> failed when the send is refused).
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import StorageJson from '@deepseek-ai/dsh-storage-json'
import StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Analysis } from '../src/analysis.ts'
import { Materials } from '../src/materials.ts'
import { NotesSettings } from '../src/settings.ts'

let ctx: Context | undefined
let root: string | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-notes-analysis-'))
  ctx = new Context()
  await ctx.plugin(Storage).await()
  await ctx.plugin(StorageJson, { root }).await()
  await ctx.plugin(StorageDomain, { backend: 'json' }).await()
})

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await rm(root!, { recursive: true, force: true })
})

describe('notes analysis', () => {
  it('submits once and records the submitted message id', async () => {
    const followup = vi.fn()
    ctx!.provide('agents', { get: () => ({ followup, session: { id: 's1' } }) } as never)

    await ctx!.plugin(Materials).await()
    await ctx!.plugin(NotesSettings, { strategy: 'manual', actions: [], workspace: null, model: null }).await()
    await ctx!.plugin(Analysis).await()
    const materials = ctx!.notesMaterials
    const analysis = ctx!.notesAnalysis

    const id = await materials.create({
      noteId: 'n1', kind: 'text', text: 'body', image: null,
      source: { sessionId: 's1', view: 'chat', seq: 1, messageId: null, callId: null, label: 'l' },
      action: null, order: 0, status: 'draft', messageIds: [], error: null, createdAt: 0, archivedAt: null,
    })

    await analysis.analyse(id, 's1')

    expect(followup).toHaveBeenCalledTimes(1)
    const sent = followup.mock.calls[0]?.[0] as { id: string; content: unknown }
    expect(sent.content).toEqual([{ type: 'text', text: 'body' }])
    const stored = materials.get(id)
    expect(stored?.messageIds).toEqual([sent.id])
    expect(stored?.status).toBe('analyzing')
  })

  it('rolls the id back and marks the material failed when the send throws', async () => {
    const followup = vi.fn(() => { throw new Error('inbox rejected') })
    ctx!.provide('agents', { get: () => ({ followup, session: { id: 's1' } }) } as never)

    await ctx!.plugin(Materials).await()
    await ctx!.plugin(NotesSettings, { strategy: 'manual', actions: [], workspace: null, model: null }).await()
    await ctx!.plugin(Analysis).await()
    const materials = ctx!.notesMaterials
    const analysis = ctx!.notesAnalysis

    const id = await materials.create({
      noteId: 'n1', kind: 'text', text: 'body', image: null,
      source: { sessionId: 's1', view: 'chat', seq: 1, messageId: null, callId: null, label: 'l' },
      action: null, order: 0, status: 'draft', messageIds: [], error: null, createdAt: 0, archivedAt: null,
    })

    await expect(analysis.analyse(id, 's1')).rejects.toThrow('inbox rejected')
    const stored = materials.get(id)
    expect(stored?.messageIds).toEqual([])
    expect(stored?.status).toBe('failed')
    expect(stored?.error).toBe('inbox rejected')
  })

  it('refuses to analyse a material that already entered the session', async () => {
    const followup = vi.fn()
    ctx!.provide('agents', { get: () => ({ followup, session: { id: 's1' } }) } as never)

    await ctx!.plugin(Materials).await()
    await ctx!.plugin(NotesSettings, { strategy: 'manual', actions: [], workspace: null, model: null }).await()
    await ctx!.plugin(Analysis).await()
    const materials = ctx!.notesMaterials
    const analysis = ctx!.notesAnalysis

    const id = await materials.create({
      noteId: 'n1', kind: 'text', text: 'body', image: null,
      source: { sessionId: 's1', view: 'chat', seq: 1, messageId: null, callId: null, label: 'l' },
      action: null, order: 0, status: 'analyzing', messageIds: ['already-sent'], error: null, createdAt: 0, archivedAt: null,
    })

    await analysis.analyse(id, 's1')
    expect(followup).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 5: 跑测试确认红**

Run: `pnpm exec vitest run packages/notes/notes/tests/analysis.host.spec.ts`

Expected: FAIL——`../src/analysis.ts` 不存在。

- [ ] **Step 6: 写 `src/analysis.ts`**

```text
/**
 * Analysis orchestration: turning a stored material into one model request.
 *
 * Every path is `followup()`, never `inject()`: `inject` parks content in the
 * inbox until the next message merges it into the SAME request, which would
 * collapse several materials into one answer and break the panel's
 * one-row-one-answer rule. The two strategies differ only in when the follow-up
 * happens, not in how.
 * @module @deepseek-ai/dsh-notes/analysis
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { composeBody } from './compose.ts'
import type { Materials } from './materials.ts'
import type { NotesSettings } from './settings.ts'
import type { MaterialId } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Submits materials into the notes conversation. */
    notesAnalysis: Analysis
  }
}

/** Drives materials into the notes conversation. */
export class Analysis extends Service {
  static inject = ['agents', 'notesMaterials', 'notesSettings']

  /**
   * @param ctx - host context carrying the agent registry, the material store,
   *   and the live notes settings.
   */
  constructor(ctx: Context) {
    super(ctx, 'notesAnalysis')
  }

  private get materials(): Materials {
    return this.ctx.notesMaterials
  }

  private get settings(): NotesSettings {
    return this.ctx.notesSettings
  }

  /**
   * Submit one material for analysis.
   * @param id - material id.
   * @param noteSessionId - the dsh Session the material belongs to.
   * @throws when the session is gone, or when the inbox refuses the message.
   */
  async analyse(id: MaterialId, noteSessionId: string): Promise<void> {
    const current = this.materials.get(id)
    if (current === undefined) return
    if (current.messageIds.length > 0) return
    const agent = this.ctx.agents.get(noteSessionId as SessionId)
    if (agent === undefined) throw new Error(`notes: no live session ${noteSessionId}`)
    await this.submit(id, agent, composeBody(current, this.settings.actions()))
  }

  /**
   * Ask a follow-up inside one material's thread.
   * @param id - material id.
   * @param question - the user's question.
   * @throws when the material never entered a session, or its session is gone.
   */
  async ask(id: MaterialId, question: string): Promise<void> {
    const current = this.materials.get(id)
    if (current === undefined || current.messageIds.length === 0) return
    const agent = this.ctx.agents.get(current.source.sessionId as SessionId)
    if (agent === undefined) throw new Error('notes: the notes session is gone')
    await this.submit(id, agent, question)
  }

  /**
   * Record the message identity, send it, and roll the identity back when the
   * send is refused.
   *
   * The order is deliberate. `Agent.followup()` returns void, so the sequence a
   * message lands on is never knowable at the call site; its id is knowable
   * before the send because `createUserMessage` mints it. Recording first means
   * no committed message can exist without its id already stored. The rollback
   * keeps a refused send from parking the material in `analyzing` forever, since
   * `analyse` reads a non-empty `messageIds` as "already sent".
   * @param id - material id.
   * @param agent - the live notes agent.
   * @param text - the body to submit.
   */
  private async submit(id: MaterialId, agent: Agent, text: string): Promise<void> {
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'notes' },
    })
    await this.materials.update(id, record => ({
      ...record,
      status: 'analyzing',
      messageIds: [...record.messageIds, message.id],
      error: null,
    }))
    try {
      agent.followup(message)
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      await this.materials.update(id, record => ({
        ...record,
        status: 'failed',
        messageIds: record.messageIds.filter(candidate => candidate !== message.id),
        error: reason,
      }))
      throw error
    }
  }
}

export default Analysis
```

`Agent.followup()` **可能同步抛错**——inbox 的 splice 会校验 JSON 与 surface 元数据,仓内先例 `packages/acp/acp/src/session.ts` 就为此包了 try/catch,所以这里的 try/catch 是必需的而不是防御性代码。

- [ ] **Step 7: 在 `apply` 里挂载 `Analysis`**

`src/index.ts` 的 `apply` 追加一行:

```text
  ctx.plugin(Analysis)
```

并把 `src/analysis.ts`、`src/compose.ts` 加进 `tsconfig.host.json` 的 `files` 数组。

`Analysis` 声明了 `static inject = ['agents', 'notesMaterials', 'notesSettings']`,必须挂在这三个服务可用之后——`NotesSettings` 由 Task 8 挂上,顺序没有问题。

- [ ] **Step 8: 跑测试**

Run: `pnpm exec vitest run packages/notes/notes/tests/compose.host.spec.ts packages/notes/notes/tests/analysis.host.spec.ts`

Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add packages/notes/notes
git commit -m "feat(notes): submit materials to the notes conversation"
```

---

### Task 10: Agent Note 与真实组合测试

**Files:**
- Create: `.agents/notes/implemented/feature/2026-09-11-web-notes-plugin.md`
- Create: `.agents/notes/implemented/feature/2026-09-11-web-notes-plugin.zh.md`
- Create: `.agents/notes/implemented/feature/2026-09-11-web-notes-plugin.i18n.yaml`
- Create: `packages/notes/notes/tests/notes-composition.host.spec.ts`

**Interfaces:**
- Consumes: Task 1-9 的全部产物。
- Produces: 仓库要求的决策记录;一条真实 Loader 组合测试。

**为什么必须有这一条:** `packages/AGENTS.md` 规定产品可见插件需要非单测的真实组合测试——手工 `ctx.plugin(...)` 的套件不算数。本计划的其余测试都是后者。

- [ ] **Step 1: 写组合测试(先红)**

`packages/notes/notes/tests/notes-composition.host.spec.ts` 通过 Loader 启动一个测试专用 `cordis.yml`,其中包含 `@deepseek-ai/dsh-notes` 行与它依赖的 storage/settings 行,断言插件到达 active 且 `ctx.notesMaterials` 可用。

测试专用 yml 由 spec 在它自己独占的临时目录里写出来,行内容照抄 `packages/bundle/base/cordis.patch.yml` 的 storage 三行加一行 notes。**不提交 fixtures 文件:** 套件在 fork worker 里与其他门禁进程并发运行,一个共享的 fixture 路径(或一个指向它的共享环境变量)会把它们耦在一起。行内容:

```text
- id: storage
  name: '@deepseek-ai/dsh-storage'
- id: storage-json
  name: '@deepseek-ai/dsh-storage-json'
  config:
    root: !!js process.env.DSH_NOTES_TEST_ROOT
- id: storage-domain
  name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- id: notes
  name: '@deepseek-ai/dsh-notes'
```

断言:Loader 树 settle 后 notes 行处于 active,`ctx.notesSessions.list()` 返回空数组,且 dispose 后域被关闭。测试自己创建与清理 `DSH_NOTES_TEST_ROOT` 指向的临时目录(参照 `packages/*/tests` 里既有的 Loader 组合测试写法,套件在 fork worker 中并发运行,临时路径必须本套件独占)。

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm exec vitest run packages/notes/notes/tests/notes-composition.host.spec.ts`

Expected: FAIL——fixture 或断言尚未成立。

- [ ] **Step 3: 让测试转绿**

按失败信息修正:通常是 `src/index.ts` 的 `inject` 缺 `storageDomain`、或 `apply` 没有先后打开两个服务。注意 `Materials` 与 `NoteSessions` 都 `inject = ['storageDomain']`,并且都要在插件 init 里 `ready()`——把 `ready()` 放进 `[Service.init]` 或等价的初始化钩子,不要让调用方去 await。

- [ ] **Step 4: 跑测试**

Run: `pnpm exec vitest run packages/notes/notes/tests/notes-composition.host.spec.ts`

Expected: PASS。

- [ ] **Step 5: 写 Agent Note(英文)**

`.agents/notes/implemented/feature/2026-09-11-web-notes-plugin.md`。内容按 `.agents/notes/README.md` 的要求:决策是什么、为什么这样、放弃了什么、需要什么验证。必须记录的三条:

1. 为什么笔记问答走真实 session 而不是旁路 `ctx.llm.stream`(Model-visible ⟺ logged 的运行时不变式,以及旁路还需要自建 RPC 把浏览器字节变成 `ImageAttachmentRef`)。
2. 为什么两种策略都走 `followup()` 而不是 `inject()`(`inject` 会把多条素材合并进同一次请求,与"各答各的"冲突)。
3. 为什么线程归属用显式 seq 记录而不是连续区间(追问可能不与首次分析相邻)。

- [ ] **Step 6: 写中文副本并生成配对记录**

```bash
git add .agents/notes/implemented/feature/2026-09-11-web-notes-plugin.md \
        .agents/notes/implemented/feature/2026-09-11-web-notes-plugin.zh.md
pnpm run verify-translation-pairing --write .agents/notes/implemented/feature/2026-09-11-web-notes-plugin.md
```

Expected: 生成 `.i18n.yaml`。

- [ ] **Step 7: 跑本阶段的全部门禁**

```bash
pnpm run test:gui
pnpm run verify-md-wrap
pnpm run verify-md-links
pnpm run verify-translation-pairing
pnpm run verify-cordis-config
pnpm run verify-client-packages
```

Expected: 全部退出码 0。`test:gui` 若在未改动的代码上红,不要静默修也不要忽略——在交接说明里记下来。

- [ ] **Step 8: 更新包 README 的 Model Experience**

素材从这一刻起进入模型请求,`## Model Experience` 不能再写 None。改写英文与中文两份,并重录配对:

```bash
git add packages/notes/notes/README.md packages/notes/notes/README.zh.md
pnpm run verify-translation-pairing --write packages/notes/notes/README.md
```

- [ ] **Step 9: 提交**

```bash
git add packages/notes/notes .agents/notes
git commit -m "feat(notes): compose materials into model requests"
```

---

## 本计划未覆盖的部分

以下属于后续计划,本计划的产出是它们的前置:

- **Phase 1 剩余**:Remote 命名空间(服务类 + 生成物 + `api/remotes` 装配)、截图落盘、会话创建与工作区、素材归档与排序的对外操作。这些依赖 Task 9 的编排形态定稿后再做,避免接口返工。
- **Phase 2**:面板 UI(浮窗 / 停靠两态、左列表、右详情)。
- **Phase 3**:划词浮层与来源解析、截图粘贴通路、定位原文的纯展示入口。
- **Phase 4**:动作注册表的外露与设置卡。
