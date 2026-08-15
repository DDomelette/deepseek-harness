# Web 会话引用（composer `@` 会话提及）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Web composer 输入 `@` 时列出当前工作区的普通会话，选中后插入 chip，发送时把所选会话的只读快照消息注入到当前消息之前。

**Architecture:** 新增宿主插件 `@deepseek-ai/dsh-session-reference-admission`，在 `agent/pre-step` 瀑布最外层解析直发消息中的规范 `dsh-session:` 提及、调用既有 `ctx.sessionReferenceResolver.prepare`、替换直发消息并前置快照。新增浏览器插件 `@deepseek-ai/dsh-client-ui-session-reference`，注册 `@` `session` source，从 `ctx.sessions.list` 生成候选并走 `ReferenceInsert` chip + codec。`packages/bundle/web-app` 挂三行，不改 apiproxy、wire、input machine 或 `InputTriggerCandidate`。

**Tech Stack:** TypeScript ESM (strict)、vendored Cordis、`@deepseek-ai/dsh-session-reference`、`@deepseek-ai/dsh-client-ui-input-trigger`、React 18、vitest、Playwright e2e、tsdown client bundle。

**Spec:** `docs/superpowers/specs/2026-08-16-web-session-references-design.md`（approved；worktree `.worktrees/feature/web-session-references`，分支 `feature/web-session-references`）。

## Global Constraints

- 所有命令在 worktree 根 `/home/huawei/deepseek-harness/.worktrees/feature/web-session-references` 下执行。
- 只创建 `packages/context/session-reference-admission`、`packages/client/ui-session-reference`；只修改 `tsconfig.host.json`、`tsconfig.client.json`、`packages/client/ui-input-trigger/src/client/locales.ts`、`packages/bundle/web-app/package.json`、`packages/bundle/web-app/cordis.patch.yml`、`scripts/translation-pairing.manifest.json` 以及新包的 README/tests；不修改 apiproxy、wire、input machine、`InputTriggerCandidate`。
- 规范提及格式：`@[label](dsh-session:<base64url(JSON.stringify(sessionId))>)`；browser 编码器与 host `Buffer.toString('base64url')` 的已知字面量全等。
- 候选过滤：与当前会话 `cwd` 全等、非 blank、非 `origin: 'subagent'`、排除自己；上限 50；`order: -1`。
- 快照上限沿用 resolver 默认值：`maxReferences: 3`、`maxReferenceBytes: 65536`；browser 的 50 项上限不读 `candidateLimit`。
- admission 只扫描 `role === 'user' && source.kind === 'user'`；用 `ctx.on('agent/pre-step', handler, { prepend: true })`；先 `next()` 再改写；无引用返回原 decision 对象。
- 失败 fail-closed：parse/read/budget/self/over-limit 错误从 pre-step 抛出，走 `turn/end{reason:'error'}` 与 `host/agent-error`，不返回 `{kind:'reject'}`。
- 包规则：宿主插件 named-export `name`/`inject`/`apply`，无 default export；每个包有 `./invariant`；`@deepseek-ai/cordis` 在 peerDependencies 与 devDependencies；README 中英双语对 + `README.i18n.yaml`；product copy 中文，代码注释英文。
- 测试命令：`pnpm --filter <pkg> test`；类型检查 `pnpm exec tsc -b packages/context/session-reference-admission packages/client/ui-session-reference`；bundle 构建 `pnpm --filter @deepseek-ai/dsh-client-ui-session-reference bundle`；GUI 检查 `pnpm run test:gui`；Web 检查 `DSH_SNAPSHOT=replay pnpm run test:web`。
- 每个 Task 以可独立验证的提交结束；提交信息如 `feat(session-reference): ...`。
- 本计划本身中文单文件，已加入 `scripts/translation-pairing.manifest.json` 排除列表。

---

### Task 1: 宿主 admission 包骨架（package / tsconfig / 空实现 / invariant / README）

**Files:**
- Create: `packages/context/session-reference-admission/package.json`
- Create: `packages/context/session-reference-admission/tsconfig.json`
- Create: `packages/context/session-reference-admission/src/index.ts`
- Create: `packages/context/session-reference-admission/src/invariant.ts`
- Create: `packages/context/session-reference-admission/README.md`
- Create: `packages/context/session-reference-admission/README.zh.md`
- Create: `packages/context/session-reference-admission/README.i18n.yaml`
- Modify: `tsconfig.host.json`（在 `packages/context/session-reference` 之后插入 `{ "path": "./packages/context/session-reference-admission" }`）

**Interfaces:**
- Consumes: `ctx.sessionReferenceResolver`（`@deepseek-ai/dsh-session-reference`）、`agent/pre-step` 事件类型（`@deepseek-ai/dsh-agent`）。
- Produces（Task 2 及后续依赖）：
  - `export const name = 'session-reference-admission'`
  - `export const inject = ['sessionReferenceResolver']`
  - `export function apply(ctx: Context): void`

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "@deepseek-ai/dsh-session-reference-admission",
  "description": "Pre-step admission for canonical session-reference mentions in direct user messages",
  "version": "0.1.0-rc.5",
  "publishConfig": {
    "access": "public"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deepseek-ai/deepseek-harness.git",
    "directory": "packages/context/session-reference-admission"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./invariant": {
      "types": "./lib/types/invariant.d.ts",
      "default": "./lib/invariant.js"
    },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "files": [
    "lib/index.js",
    "lib/invariant.js",
    "lib/types/**/*.d.ts"
  ],
  "license": "MIT",
  "peerDependencies": {
    "@deepseek-ai/dsh-agent": "workspace:^",
    "@deepseek-ai/dsh-invariants": "workspace:^",
    "@deepseek-ai/dsh-llm": "workspace:^",
    "@deepseek-ai/dsh-session-reference": "workspace:^",
    "@deepseek-ai/cordis": "workspace:^"
  },
  "devDependencies": {
    "@deepseek-ai/dsh-agent": "workspace:^",
    "@deepseek-ai/dsh-agent-loop": "workspace:^",
    "@deepseek-ai/dsh-agent-loop-testkit": "workspace:^",
    "@deepseek-ai/dsh-invariants": "workspace:^",
    "@deepseek-ai/dsh-llm": "workspace:^",
    "@deepseek-ai/dsh-session": "workspace:^",
    "@deepseek-ai/dsh-session-query": "workspace:^",
    "@deepseek-ai/dsh-session-reference": "workspace:^",
    "@deepseek-ai/cordis": "workspace:^"
  }
}
```

- [ ] **Step 2: 写 tsconfig.json**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib/types"
  },
  "include": [
    "src"
  ],
  "references": [
    {
      "path": "../../../vendor/cordis"
    },
    {
      "path": "../../core/agent"
    },
    {
      "path": "../../llm/llm"
    },
    {
      "path": "./session-reference"
    },
    {
      "path": "../../runtime-diagnostics/invariants"
    }
  ]
}
```

- [ ] **Step 3: 写空实现 `src/index.ts`（Task 2 的失败测试基准）**

```ts
/**
 * Pre-step admission for canonical session-reference mentions.
 * @module @deepseek-ai/dsh-session-reference-admission
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'session-reference-admission'

/** The resolver whose snapshots this plugin admits into pre-step decisions. */
export const inject = ['sessionReferenceResolver']

/** Host plugin body — the pre-step listener lands in Task 2. */
export function apply(_ctx: Context): void {}
```

- [ ] **Step 4: 写 `src/invariant.ts`**

```ts
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-reference-admission`.
 * @module @deepseek-ai/dsh-session-reference-admission/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-reference-admission'

/** Cordis companion plugin name. */
export const name = 'session-reference-admission-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: admission rewrites claimed pre-step messages before
 * they become durable; the real-loop integration test pins snapshot/direct
 * order, and `@deepseek-ai/dsh-session-reference` owns the snapshot shape.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
```

- [ ] **Step 5: 写 README.md（中英结构一致，以下为英文侧全文）**

```markdown
# @deepseek-ai/dsh-session-reference-admission

English | [中文](README.zh.md)

Host plugin that admits canonical `dsh-session:` mentions in direct user messages at `agent/pre-step`. It registers with `prepend: true`, delegates through `next()`, and rewrites only the downstream decision.

## Public API

- `name = 'session-reference-admission'`
- `inject = ['sessionReferenceResolver']`
- `apply(ctx)` registers the listener for the context lifetime; no config.

## Behavior

Each `decision.messages` entry with `role === 'user'` and `source.kind === 'user'` is scanned with `parseSessionReferenceText()` block by block. Non-text blocks pass through unchanged. For a message with references, `ctx.sessionReferenceResolver.prepare()` reads and projects the sources; the direct message is replaced with `freezeMessage({ ...message, content: prepared.content })`, preserving id and source, and `prepared.additionalContext` is inserted immediately before it.

No references means the original decision object is returned unchanged. A malformed explicit mention, a failed source read, or a budget/limit error is thrown from the listener, so the agent loop records `turn/end{reason:'error'}` and never sends partial context.

## Model Experience

### Referenced-session snapshot ordering

#### What the model sees

For a message that mentions another session, the step contains the `session-reference` snapshot message followed by the readable direct message. The snapshot text is owned by `@deepseek-ai/dsh-session-reference`.

#### Token effect

Conditional and append-only: referenced sessions add one bounded snapshot message per accepted direct message; messages without references add nothing.

#### KV Cache effect

The replacement suffix begins at the snapshot message; earlier request history stays append-only.

## Known Limitations and Deferred Work

- **Pre-step failure discards the claimed direct message** — the browser half revalidates picked sessions before submit, but a race after that check surfaces as a turn-error card, not an RPC-level prompt error.
- **Other pre-step listeners see the raw canonical mention text** — they run before this outermost listener rewrites it; no current listener depends on that text.
```

- [ ] **Step 6: 写 README.zh.md（与英文侧结构逐段对应）**

```markdown
# @deepseek-ai/dsh-session-reference-admission

[English](README.md) | 中文

宿主插件，在 `agent/pre-step` 把直发消息中的规范 `dsh-session:` 提及接入执行。它以 `prepend: true` 注册，先经 `next()` 委托，再只改写下游决策。

## Public API

- `name = 'session-reference-admission'`
- `inject = ['sessionReferenceResolver']`
- `apply(ctx)` 在 context 生命周期内注册监听器；无配置。

## Behavior

`decision.messages` 中每个满足 `role === 'user'` 且 `source.kind === 'user'` 的条目按内容块调用 `parseSessionReferenceText()`。非文本块原样保留。对有引用的消息，`ctx.sessionReferenceResolver.prepare()` 读取并投影源会话；直发消息替换为 `freezeMessage({ ...message, content: prepared.content })`，保留 id 与 source，`prepared.additionalContext` 插到其正前方。

无引用时原 decision 对象原样返回。malformed 显式提及、源读取失败或预算/上限错误从监听器抛出，agent loop 记录 `turn/end{reason:'error'}`，绝不发送部分上下文。

## Model Experience

### Referenced-session snapshot ordering

#### What the model sees

对提及其他会话的消息，本轮包含 `session-reference` 快照消息及其后的可读直发消息。快照文本由 `@deepseek-ai/dsh-session-reference` 拥有。

#### Token effect

条件且仅追加：被引用会话为每条受理的直发消息增加一条有界快照消息；无提及消息零增加。

#### KV Cache effect

替换后缀从快照消息开始；更早的请求历史保持 append-only。

## Known Limitations and Deferred Work

- **Pre-step 失败会丢弃已认领的直发消息** — 浏览器半在提交前重新校验所选会话，但校验之后的竞态以 turn-error 卡片呈现，而不是 RPC 级 prompt 错误。
- **其他 pre-step 监听器看到原始规范提及文本** — 它们先于这个最外层监听器运行；当前没有监听器依赖该文本。
```

- [ ] **Step 7: 生成 README.i18n.yaml**

Run: `pnpm run verify-translation-pairing --write packages/context/session-reference-admission/README.md`

- [ ] **Step 8: 注册宿主聚合并在空实现上验证加载**

在 `tsconfig.host.json` 的 `packages/context/session-reference` 引用后插入：

```json
    { "path": "./packages/context/session-reference-admission" },
```

Run: `pnpm install --prefer-offline && pnpm exec tsc -b packages/context/session-reference-admission` Expected: PASS（空实现无类型错误）。

- [ ] **Step 9: 提交**

```bash
git add packages/context/session-reference-admission tsconfig.host.json
git commit -m "feat(session-reference): scaffold host admission package"
```

---

### Task 2: 宿主 admission 行为 TDD + 单元测试

**Files:**
- Test: `packages/context/session-reference-admission/tests/admission.spec.ts`
- Modify: `packages/context/session-reference-admission/src/index.ts`

**Interfaces:**
- Consumes: `parseSessionReferenceText`、`SessionReferenceError`（`@deepseek-ai/dsh-session-reference`）；`agentEvents`（`@deepseek-ai/dsh-agent`）。
- Produces: `normalizeDirectMessage(content): { content, references } | undefined`（内部 helper，测试经 waterfall 间接验证）。

- [ ] **Step 1: 写失败测试 `tests/admission.spec.ts`**

```ts
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { createMessage, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SessionReferenceResolver, {
  formatSessionReferenceMention,
  type SessionReferenceErrorCode,
} from '@deepseek-ai/dsh-session-reference'
import * as admission from '@deepseek-ai/dsh-session-reference-admission'
import { describe, expect, it } from 'vitest'

class TestSessionQueryEngine extends SessionQueryEngine {
  override searchSessions(
    ..._args: Parameters<SessionQueryEngine['searchSessions']>
  ): ReturnType<SessionQueryEngine['searchSessions']> {
    return Promise.resolve({ items: [] })
  }

  override searchEvents(
    ...args: Parameters<SessionQueryEngine['searchEvents']>
  ): ReturnType<SessionQueryEngine['searchEvents']> {
    return this.readSurface(args[0].sessionId).then(surface => ({
      session: surface.session,
      items: [],
    }))
  }
}

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(TestSessionQueryEngine)
  await ctx.plugin(SessionReferenceResolver)
  await ctx.plugin(admission)
  return ctx
}

function fakeAgent(session: Session): Agent {
  return { id: session.id, session } as Agent
}

function appendConversation(session: Session): void {
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'source user' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'source assistant' }],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
}

function textOf(message: UserMessage): string {
  return message.content
    .flatMap(block => block.type === 'text' ? [block.text] : [])
    .join('\n')
}

const SIGNAL = new AbortController().signal

async function fire(ctx: Context, agent: Agent, messages: UserMessage[]) {
  return agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages, turn: 1, step: 1, signal: SIGNAL },
    () => Promise.resolve({ kind: 'enter' as const, messages }),
  )
}

function expectCode(code: SessionReferenceErrorCode): Error {
  return expect.objectContaining({ code }) as Error
}

describe('session-reference admission', () => {
  it('returns the original decision object when no direct message has a mention', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'))
    const plain = createUserMessage({
      content: [{ type: 'text', text: 'ordinary message' }],
      source: { kind: 'user' },
    })
    const decision = await fire(ctx, fakeAgent(target), [plain])
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages).toHaveLength(1)
    expect(decision.messages[0]).toBe(plain)
  })

  it('places the snapshot before a rewritten direct message and preserves id/source', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'))
    const source = ctx.sessions.create(SessionId('source'))
    appendConversation(source)
    const direct = createUserMessage({
      content: [{ type: 'text', text: `交接 ${formatSessionReferenceMention({ sessionId: source.id, label: '源' })} 请继续` }],
      source: { kind: 'user' },
    })
    const decision = await fire(ctx, fakeAgent(target), [direct])
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages).toHaveLength(2)
    const [snapshot, rewritten] = decision.messages as [UserMessage, UserMessage]
    expect(snapshot.source.kind).toBe('session-reference')
    expect(snapshot.id).not.toBe(direct.id)
    expect(rewritten.id).toBe(direct.id)
    expect(rewritten.source).toEqual(direct.source)
    expect(textOf(rewritten)).toContain('@源')
    expect(textOf(rewritten)).not.toContain('dsh-session:')
    expect(textOf(snapshot)).toContain('Referenced sessions')
  })

  it('never scans plugin or session-reference messages', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'))
    const source = ctx.sessions.create(SessionId('source'))
    const mention = formatSessionReferenceMention({ sessionId: source.id, label: '源' })
    const pluginMessage = createUserMessage({
      content: [{ type: 'text', text: `plugin text ${mention}` }],
      source: { kind: 'plugin', plugin: 'test' },
    })
    const decision = await fire(ctx, fakeAgent(target), [pluginMessage])
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages).toHaveLength(1)
    expect(decision.messages[0]).toBe(pluginMessage)
  })

  it('throws on a malformed explicit mention without emitting partial context', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'))
    const malformed = createUserMessage({
      content: [{ type: 'text', text: 'see @[bad](dsh-session:%%%)' }],
      source: { kind: 'user' },
    })
    await expect(fire(ctx, fakeAgent(target), [malformed]))
      .rejects.toThrow(expectCode('SESSION_REFERENCE_INVALID_REFERENCE'))
  })

  it('throws when a valid reference cannot be read', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'))
    const missing = createUserMessage({
      content: [{ type: 'text', text: formatSessionReferenceMention({ sessionId: SessionId('missing'), label: '缺' }) }],
      source: { kind: 'user' },
    })
    await expect(fire(ctx, fakeAgent(target), [missing]))
      .rejects.toThrow(expectCode('SESSION_REFERENCE_READ_FAILED'))
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @deepseek-ai/dsh-session-reference-admission test` Expected: FAIL，`admission` 空实现不注入快照、不抛错。

- [ ] **Step 3: 实现 `src/index.ts`**

```ts
/**
 * Pre-step admission for canonical session-reference mentions.
 *
 * The listener registers with `prepend: true` so it is the outermost
 * waterfall listener: `next()` settles every downstream pre-step
 * contribution first, then this plugin rewrites only direct user messages
 * carrying canonical `dsh-session:` mentions.
 * @module @deepseek-ai/dsh-session-reference-admission
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { freezeMessage, type ContentBlock, type UserMessage } from '@deepseek-ai/dsh-llm'
import { parseSessionReferenceText, type SessionReferenceInput } from '@deepseek-ai/dsh-session-reference'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'session-reference-admission'

/** The resolver whose snapshots this plugin admits into pre-step decisions. */
export const inject = ['sessionReferenceResolver']

/** One direct message after mention parsing. */
interface NormalizedMessage {
  readonly content: ContentBlock[]
  readonly references: SessionReferenceInput[]
}

/** Parse text blocks and collect references; `undefined` means no mention. */
function normalizeDirectMessage(content: readonly ContentBlock[]): NormalizedMessage | undefined {
  const references: SessionReferenceInput[] = []
  let found = false
  const normalized = content.map((block) => {
    if (block.type !== 'text') return block
    const parsed = parseSessionReferenceText(block.text)
    if (parsed.references.length > 0) {
      found = true
      references.push(...parsed.references)
    }
    return { type: 'text' as const, text: parsed.text }
  })
  return found ? { content: normalized, references } : undefined
}

/** Host plugin body: prepended pre-step listener over the root context. */
export function apply(ctx: Context): void {
  ctx.on('agent/pre-step', async (
    { agent, messages, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const output: UserMessage[] = []
    let changed = false
    for (const message of decision.messages) {
      if (message.role !== 'user' || message.source.kind !== 'user') {
        output.push(message)
        continue
      }
      const normalized = normalizeDirectMessage(message.content)
      if (normalized === undefined) {
        output.push(message)
        continue
      }
      const prepared = await ctx.sessionReferenceResolver.prepare(
        agent,
        normalized.content,
        normalized.references,
        signal,
      )
      signal.throwIfAborted()
      if (prepared.additionalContext !== undefined) output.push(prepared.additionalContext)
      output.push(freezeMessage({ ...message, content: prepared.content }))
      changed = true
    }
    return changed ? { kind: 'enter', messages: output } : decision
  }, { prepend: true })
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @deepseek-ai/dsh-session-reference-admission test` Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/context/session-reference-admission
git commit -m "feat(session-reference): admit canonical mentions at pre-step"
```

---

### Task 3: 宿主真实组合集成测试（模型请求顺序）

**Files:**
- Test: `packages/context/session-reference-admission/tests/real-loop.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 `admission` 插件；`mountAgentLoopTestDependencies`、`AgentLoop`、`SessionReferenceResolver`。
- Produces: 无新接口；用真实 agent loop 钉住 `[snapshot, direct]` 的模型请求顺序。

- [ ] **Step 1: 写集成测试**

```ts
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createMessage, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SessionReferenceResolver, { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
import * as admission from '@deepseek-ai/dsh-session-reference-admission'
import { describe, expect, it } from 'vitest'

class TestSessionQueryEngine extends SessionQueryEngine {
  override searchSessions(
    ..._args: Parameters<SessionQueryEngine['searchSessions']>
  ): ReturnType<SessionQueryEngine['searchSessions']> {
    return Promise.resolve({ items: [] })
  }

  override searchEvents(
    ...args: Parameters<SessionQueryEngine['searchEvents']>
  ): ReturnType<SessionQueryEngine['searchEvents']> {
    return this.readSurface(args[0].sessionId).then(surface => ({
      session: surface.session,
      items: [],
    }))
  }
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield* textResponse('ok')
  }
}

async function harness() {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(TestSessionQueryEngine)
  await ctx.plugin(SessionReferenceResolver)
  await ctx.plugin(admission)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new ScriptedAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, adapter }
}

describe('session-reference admission in the real agent loop', () => {
  it('sends the snapshot immediately before the readable direct message', async () => {
    const { ctx, adapter } = await harness()
    const source = ctx.sessions.create(SessionId('source'), { meta: { cwd: '/work' } })
    source.append('turn/start', { turn: 1 })
    source.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'source user' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    source.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'source assistant' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      }),
    }, { surfaceOp: 'append' })
    source.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const target = ctx.agentLoop.create(SessionId('target'), { provider: 'mock', model: 'mock' })
    target.followup(createUserMessage({
      content: [{
        type: 'text',
        text: `交接 ${formatSessionReferenceMention({ sessionId: source.id, label: '源' })} 请继续`,
      }],
      source: { kind: 'user' },
    }))
    await target.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    const messages = adapter.requests[0]!.messages
    const snapshotIndex = messages.findIndex(message =>
      message.role === 'user' && message.source.kind === 'session-reference')
    const directIndex = messages.findIndex(message =>
      message.role === 'user' && message.source.kind === 'user')
    expect(snapshotIndex).toBeGreaterThanOrEqual(0)
    expect(directIndex).toBe(snapshotIndex + 1)
  })
})
```

- [ ] **Step 2: 运行确认通过**

Run: `pnpm --filter @deepseek-ai/dsh-session-reference-admission test` Expected: PASS，且真实 loop 的请求含快照在前、可读直发消息在后。

- [ ] **Step 3: 提交**

```bash
git add packages/context/session-reference-admission/tests/real-loop.spec.ts
git commit -m "test(session-reference): pin snapshot-before-direct order in real loop"
```

---

### Task 4: 浏览器插件包骨架与 base64url 编码器 TDD

**Files:**
- Create: `packages/client/ui-session-reference/package.json`
- Create: `packages/client/ui-session-reference/tsconfig.json`
- Create: `packages/client/ui-session-reference/tsdown.config.ts`
- Create: `packages/client/ui-session-reference/src/index.ts`
- Create: `packages/client/ui-session-reference/src/invariant.ts`
- Create: `packages/client/ui-session-reference/src/client/uri.ts`
- Create: `packages/client/ui-session-reference/src/client/index.ts`（Task 5 实现 source；先只导出 `inject`）
- Create: `packages/client/ui-session-reference/README.md`、`README.zh.md`、`README.i18n.yaml`
- Test: `packages/client/ui-session-reference/tests/uri.client.spec.ts`
- Modify: `tsconfig.client.json`（在 `ui-subagent` 后插入 `{ "path": "./packages/client/ui-session-reference" }`）

**Interfaces:**
- Consumes: `SessionId`（`@deepseek-ai/dsh-client-runtime/client`）。
- Produces：
  - `encodeSessionReferenceUri(sessionId: SessionId): string`
  - `formatSessionReferenceMention(sessionId: SessionId, label: string): string`

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "@deepseek-ai/dsh-client-ui-session-reference",
  "description": "Web composer '@' source for workspace conversation snapshot references",
  "version": "0.1.0-rc.5",
  "publishConfig": {
    "access": "public"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deepseek-ai/deepseek-harness.git",
    "directory": "packages/client/ui-session-reference"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./invariant": {
      "types": "./lib/types/invariant.d.ts",
      "default": "./lib/invariant.js"
    },
    "./client": {
      "types": "./lib/types/client/index.d.ts",
      "default": "./lib/client.js"
    },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-input-trigger"
      ],
      "platform": "web"
    }
  },
  "files": [
    "lib/index.js",
    "lib/invariant.js",
    "lib/client.js",
    "lib/types/**/*.d.ts"
  ],
  "license": "MIT",
  "peerDependencies": {
    "@deepseek-ai/dsh-client-runtime": "workspace:^",
    "@deepseek-ai/dsh-client-ui-input-trigger": "workspace:^",
    "@deepseek-ai/dsh-invariants": "workspace:^",
    "@deepseek-ai/cordis": "workspace:^"
  },
  "devDependencies": {
    "@deepseek-ai/dsh-client-runtime": "workspace:^",
    "@deepseek-ai/dsh-client-ui-input-trigger": "workspace:^",
    "@deepseek-ai/dsh-invariants": "workspace:^",
    "@deepseek-ai/cordis": "workspace:^"
  }
}
```

- [ ] **Step 2: 写 tsconfig.json**

```json
{
  "extends": "../../../tsconfig.base.client.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib/types"
  },
  "include": [
    "src"
  ],
  "references": [
    {
      "path": "../../../vendor/cordis"
    },
    {
      "path": "../runtime"
    },
    {
      "path": "../ui-input-trigger"
    },
    {
      "path": "../../runtime-diagnostics/invariants"
    }
  ]
}
```

- [ ] **Step 3: 写 tsdown.config.ts、node 半、invariant**

```ts
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-session-reference', ['lib/types/index.js', 'lib/types/invariant.js'])
```

`src/index.ts`：

```ts
/**
 * Session-reference plugin, node half. Pure UI plugin: the empty apply
 * exists so the plugin appears in the host composition; the browser half
 * ships via exports["./client"] and the package.json dsh.client declaration.
 */

/** Host plugin body — no host-side behavior for this source plugin. */
export function apply(): void {}
```

`src/invariant.ts`：

```ts
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-session-reference`.
 * @module @deepseek-ai/dsh-client-ui-session-reference/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-session-reference'

/** Cordis companion plugin name. */
export const name = 'client-ui-session-reference-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: one input-trigger source registration whose disposal
 * is proven by the browser-plugin spec; the package emits no cordis events
 * and owns no cross-plugin mutable state.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
```

- [ ] **Step 4: 写失败测试 `tests/uri.client.spec.ts`**

```ts
// @vitest-environment jsdom
import { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it } from 'vitest'
import { encodeSessionReferenceUri, formatSessionReferenceMention } from '../src/client/uri.ts'

describe('browser session-reference URI encoder', () => {
  it.each([
    ['session-123', 'InNlc3Npb24tMTIzIg'],
    ['会话-任务 交接', 'IuS8muivnS3ku7vliqEg5Lqk5o6lIg'],
    ['a"b\\c', 'ImFcImJcXGMi'],
    ['line1\nline2', 'ImxpbmUxXG5saW5lMiI'],
    ['x/y/z', 'IngveS96Ig'],
  ] as const)('encodes %j exactly like the host encoder', (id, payload) => {
    expect(encodeSessionReferenceUri(SessionId(id))).toBe(`dsh-session:${payload}`)
  })

  it('escapes label brackets and backslashes in the mention', () => {
    expect(formatSessionReferenceMention(SessionId('s-1'), '源]会话'))
      .toBe('@[源\\]会话](dsh-session:InMtMSI)')
  })
})
```

- [ ] **Step 5: 运行确认失败**

Run: `pnpm --filter @deepseek-ai/dsh-client-ui-session-reference test` Expected: FAIL（`../src/client/uri.ts` 不存在）。

- [ ] **Step 6: 实现 `src/client/uri.ts`**

```ts
/**
 * Browser-compatible canonical session-reference URI encoding.
 * The output is byte-identical to the host encoder in
 * `@deepseek-ai/dsh-session-reference` (`Buffer.toString('base64url')`).
 */

import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

const BYTE_CHUNK = 0x8000

/** Base64url-encode UTF-8 bytes without a Node Buffer dependency. */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BYTE_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BYTE_CHUNK))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Encode one session id as the canonical `dsh-session:` URI. */
export function encodeSessionReferenceUri(sessionId: SessionId): string {
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(sessionId)))
  return `dsh-session:${payload}`
}

/** Render one canonical Markdown mention with a readable label. */
export function formatSessionReferenceMention(sessionId: SessionId, label: string): string {
  const escaped = label.replace(/[\\\]]/gu, match => `\\${match}`)
  return `@[${escaped}](${encodeSessionReferenceUri(sessionId)})`
}
```

- [ ] **Step 7: 运行确认通过并补 README 对**

Run: `pnpm --filter @deepseek-ai/dsh-client-ui-session-reference test` Expected: PASS。

写 `README.md`：

```markdown
# @deepseek-ai/dsh-client-ui-session-reference

English | [中文](README.zh.md)

Web composer `@` source for workspace conversation snapshot references. It registers `InputTriggerSource{ trigger: '@', name: 'session', order: -1 }` over the warm `ctx.sessions.list` snapshot.

## Behavior

Candidates are sessions whose `cwd` equals the current session's `cwd`, excluding the current session, `blank: true` rows, and `origin: 'subagent'` rows. Query matching is a case-insensitive substring over `displayTitle` and session id; results keep host list order and cap at 50. Duplicate titles add `description: sessionId`.

Picking inserts a structured `ReferenceInsert` with `ref = sessionId`, `label = displayTitle`, and `clipboardText = @[label](dsh-session:<canonical-id>)`. The codec serializes the same canonical mention at submit, resolving the label from the current list row, then the pick-time label, then the session id. When the list is ready and the session is absent, serialization rejects and the input machine keeps the draft.

The browser encoder is a local UTF-8 base64url function; its output matches the host encoder byte for byte.

## Model Experience

### Canonical mention in the direct user message

#### What the model sees

The submitted direct message contains `@[label](dsh-session:<canonical-id>)` text before `@deepseek-ai/dsh-session-reference-admission` rewrites it; the snapshot itself is owned by that host plugin.

#### Token effect

The chip adds one canonical mention line to the direct user message; snapshot tokens are owned by the admission plugin.

#### KV Cache effect

Append-only: the mention rides the new user message and does not rewrite earlier history.

## Known Limitations and Deferred Work

- **Strict same-cwd candidates only** — cross-workspace handoff is out of scope.
- **Duplicate titles use the session id as description** — no richer disambiguation UI.
- **Labels can fall back to the session id** — when the session leaves the list between pick and submit and no pick-time label survives.
```

写 `README.zh.md`（结构逐节对应）：

```markdown
# @deepseek-ai/dsh-client-ui-session-reference

[English](README.md) | 中文

Web composer 的工作区会话快照引用 `@` source。它把 `InputTriggerSource{ trigger: '@', name: 'session', order: -1 }` 注册到热着的 `ctx.sessions.list` 快照上。

## Behavior

候选是 `cwd` 等于当前会话 `cwd` 的会话，排除当前会话、`blank: true` 行与 `origin: 'subagent'` 行。查询匹配是对 `displayTitle` 与 session id 的大小写不敏感子串；结果保持宿主列表顺序，上限 50。重复标题补充 `description: sessionId`。

选中后插入结构化 `ReferenceInsert`，其中 `ref = sessionId`、`label = displayTitle`、`clipboardText = @[label](dsh-session:<canonical-id>)`。codec 在提交时序列化同一规范提及，标签先取当前列表行，再取 pick 时标签，最后取 session id。列表 ready 且会话缺失时，序列化拒绝，输入机保留草稿。

浏览器编码器是本地 UTF-8 base64url 函数；其输出与宿主编码器逐字节一致。

## Model Experience

### Canonical mention in the direct user message

#### What the model sees

提交的直发消息在 `@deepseek-ai/dsh-session-reference-admission` 改写前包含 `@[label](dsh-session:<canonical-id>)` 文本；快照本身由该宿主插件拥有。

#### Token effect

chip 为直发消息增加一行规范提及；快照 token 由 admission 插件拥有。

#### KV Cache effect

仅追加：提及随新用户消息进入，不重写更早历史。

## Known Limitations and Deferred Work

- **仅严格同 cwd 候选** — 跨工作区交接不在范围内。
- **重复标题用 session id 作为 description** — 没有更丰富的消歧界面。
- **标签可能回退到 session id** — 当会话在 pick 与提交之间离开列表且没有 pick 时标签时。
```

写完后运行 `pnpm run verify-translation-pairing --write packages/client/ui-session-reference/README.md`。

- [ ] **Step 8: 注册客户端聚合**

在 `tsconfig.client.json` 的 `ui-subagent` 引用后插入：

```json
    { "path": "./packages/client/ui-session-reference" },
```

Run: `pnpm install --prefer-offline && pnpm exec tsc -b packages/client/ui-session-reference` Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add packages/client/ui-session-reference tsconfig.client.json
git commit -m "feat(session-reference): scaffold browser package and URI codec"
```

---

### Task 5: 浏览器 `@` source 行为 TDD + 单元测试

**Files:**
- Test: `packages/client/ui-session-reference/tests/browser-plugin.client.spec.ts`
- Modify: `packages/client/ui-session-reference/src/client/index.ts`

**Interfaces:**
- Consumes: `ctx.sessions.list`、`ctx.inputTriggers`（Task 4 包内依赖）。
- Produces：`InputTriggerSource`（`trigger: '@'`、`name: 'session'`、`order: -1`）、`ReferenceInsert`（`source: 'session'`、`ref: sessionId`）、`ReferenceCodec`。

- [ ] **Step 1: 写失败测试 `tests/browser-plugin.client.spec.ts`**

```ts
// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import type {
  SessionId, SessionListState, SessionSummary,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ClientSessionContext, InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

const sid = (id: string): SessionId => id as SessionId

function summary(partial: Partial<SessionSummary> & { id: SessionId }): SessionSummary {
  return {
    displayTitle: partial.id,
    running: false,
    updatedAt: 0,
    blank: false,
    ...partial,
  } as SessionSummary
}

function sessionsWith(rows: SessionSummary[]) {
  const byId = Object.fromEntries(rows.map(row => [row.id, row])) as SessionListState['byId']
  const snapshot = {
    ids: rows.map(row => row.id),
    byId,
    current: rows[0]?.id,
    phase: 'ready',
  } as unknown as SessionListState
  const listeners = new Set<() => void>()
  return {
    list: {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
  }
}

async function bench(rows: SessionSummary[]): Promise<InputTriggerSource> {
  const ctx = new Context()
  let captured: InputTriggerSource | undefined
  ctx.provide('inputTriggers', {
    registerSource: (source: InputTriggerSource) => {
      captured = source
      return () => {}
    },
  })
  ctx.provide('sessions', sessionsWith(rows))
  await ctx.plugin({ inject: [...inject], apply }).await()
  return captured!
}

const proj = (id: string): ClientSessionContext => ({ sessionId: sid(id) })

const req = (query: string) => ({
  query,
  position: 'inline' as const,
  signal: new AbortController().signal,
})

describe('ui-session-reference source', () => {
  it('declares its service edges', () => {
    expect(inject).toEqual(['inputTriggers', 'sessions'])
  })

  it('registers the ordered @ session source', async () => {
    const source = await bench([summary({ id: sid('current'), cwd: '/w', displayTitle: '当前' })])
    expect(source).toMatchObject({ trigger: '@', name: 'session', order: -1 })
  })

  it('filters strictly to the current cwd and excludes self, blank, and subagents', async () => {
    const rows = [
      summary({ id: sid('current'), cwd: '/w', displayTitle: '当前' }),
      summary({ id: sid('same'), cwd: '/w', displayTitle: '同区' }),
      summary({ id: sid('blank'), cwd: '/w', displayTitle: '空白', blank: true }),
      summary({ id: sid('child'), cwd: '/w', displayTitle: '子代理', origin: 'subagent' }),
      summary({ id: sid('other'), cwd: '/x', displayTitle: '异区' }),
    ]
    const source = await bench(rows)
    const candidates = await source.candidates(proj('current'), req(''))
    expect(candidates.map(item => item.name)).toEqual(['同区'])
  })

  it('matches query against title and id, caps at 50, and keeps list order', async () => {
    const rows = [summary({ id: sid('current'), cwd: '/w', displayTitle: '当前' })]
    for (let index = 0; index < 60; index++) {
      rows.push(summary({ id: sid(`s-${String(index).padStart(2, '0')}`), cwd: '/w', displayTitle: `任务 ${String(index)}` }))
    }
    const source = await bench(rows)
    const candidates = await source.candidates(proj('current'), req(''))
    expect(candidates).toHaveLength(50)
    expect(candidates[0]!.name).toBe('任务 0')
  })

  it('disambiguates duplicate titles with the session id description', async () => {
    const source = await bench([
      summary({ id: sid('current'), cwd: '/w', displayTitle: '当前' }),
      summary({ id: sid('a'), cwd: '/w', displayTitle: '同名' }),
      summary({ id: sid('b'), cwd: '/w', displayTitle: '同名' }),
    ])
    const candidates = await source.candidates(proj('current'), req('同名'))
    expect(candidates).toHaveLength(2)
    expect(candidates[0]!.description).toBe('a')
    expect(candidates[1]!.description).toBe('b')
  })

  it('picks a structured ReferenceInsert with the session id', async () => {
    const source = await bench([
      summary({ id: sid('current'), cwd: '/w', displayTitle: '当前' }),
      summary({ id: sid('source'), cwd: '/w', displayTitle: '交接源' }),
    ])
    const candidate = (await source.candidates(proj('current'), req('交接')))[0]!
    const outcome = source.onPick({
      candidate,
      session: proj('current'),
      position: 'inline',
      via: 'menu',
      span: { start: 0, end: 1, draftRev: 1 },
    })
    expect(outcome).toMatchObject({
      insert: {
        source: 'session',
        ref: 'source',
        label: '交接源',
        clipboardText: '@[交接源](dsh-session:InNvdXJjZSI)',
      },
    })
  })

  it('serializes the canonical mention and rejects early when the session left a ready list', async () => {
    const rows = [
      summary({ id: sid('current'), cwd: '/w', displayTitle: '当前' }),
      summary({ id: sid('source'), cwd: '/w', displayTitle: '交接源' }),
    ]
    const source = await bench(rows)
    await expect(source.codec!.serialize(sid('source'), new AbortController().signal))
      .resolves.toBe('@[交接源](dsh-session:InNvdXJjZSI)')

    rows[1] = summary({ id: sid('source'), cwd: '/w', displayTitle: '新标题' })
    await expect(source.codec!.serialize(sid('source'), new AbortController().signal))
      .resolves.toContain('新标题')

    rows.splice(1, 1)
    await expect(source.codec!.serialize(sid('source'), new AbortController().signal))
      .rejects.toThrow('会话引用已失效')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @deepseek-ai/dsh-client-ui-session-reference test` Expected: FAIL（`src/client/index.ts` 尚未导出 source 行为）。

- [ ] **Step 3: 实现 `src/client/index.ts`**

```ts
/**
 * Session-reference plugin, browser half: the '@' `session` source over the
 * warm session list. Candidates are same-cwd ordinary conversations; picking
 * one inserts a structured ReferenceInsert chip whose codec serializes the
 * canonical `@[label](dsh-session:<id>)` mention.
 */

import type {
  ClientContext, SessionId, SessionListState, SessionSummary,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ClientSessionContext, InputTriggerCandidate, InputTriggerServiceContract,
  InputTriggerSource, ReferenceCodec,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { formatSessionReferenceMention } from './uri.ts'

export const inject = ['inputTriggers', 'sessions']

const MAX_CANDIDATES = 50

/** Human-facing error when a picked session left the ready list before submit. */
const SOURCE_GONE_MESSAGE = '会话引用已失效：所选会话不在当前工作区'

/** Return same-cwd ordinary sessions for one query, in host list order. */
function matchingSessions(sessions: ClientContext['sessions'], session: ClientSessionContext, query: string): SessionSummary[] {
  const snapshot = sessions.list.getSnapshot()
  const current = snapshot.byId[session.sessionId]
  if (current?.cwd === undefined) return []
  const needle = query.toLocaleLowerCase()
  const out: SessionSummary[] = []
  for (const id of snapshot.ids) {
    const row = snapshot.byId[id]
    if (row === undefined || id === session.sessionId) continue
    if (row.cwd !== current.cwd || row.blank || row.origin === 'subagent') continue
    if (needle !== ''
      && !row.displayTitle.toLocaleLowerCase().includes(needle)
      && !id.toLocaleLowerCase().includes(needle)) continue
    out.push(row)
    if (out.length === MAX_CANDIDATES) break
  }
  return out
}

/** Browser plugin body. */
export function apply(ctx: ClientContext): void {
  const sessions = ctx.sessions
  const candidateSessions = new WeakMap<InputTriggerCandidate, SessionSummary>()
  const labels = new Map<SessionId, string>()

  const labelFor = (id: SessionId): string => {
    const live = sessions.list.getSnapshot().byId[id]
    return live?.displayTitle ?? labels.get(id) ?? id
  }

  const codec: ReferenceCodec = {
    clipboardText(ref) {
      const id = ref as SessionId
      return formatSessionReferenceMention(id, labelFor(id))
    },
    serialize(ref) {
      const id = ref as SessionId
      const snapshot = sessions.list.getSnapshot()
      if (snapshot.phase === 'ready' && snapshot.byId[id] === undefined) {
        return Promise.reject(new Error(SOURCE_GONE_MESSAGE))
      }
      return Promise.resolve(formatSessionReferenceMention(id, labelFor(id)))
    },
  }

  const source: InputTriggerSource = {
    trigger: '@',
    name: 'session',
    order: -1,
    candidates(session, { query, signal }) {
      if (signal.aborted) return Promise.resolve([])
      const rows = matchingSessions(sessions, session, query)
      const counts = new Map<string, number>()
      for (const row of rows) counts.set(row.displayTitle, (counts.get(row.displayTitle) ?? 0) + 1)
      return Promise.resolve(rows.map((row) => {
        const candidate: InputTriggerCandidate = {
          name: row.displayTitle,
          ...(counts.get(row.displayTitle) ?? 0) > 1 ? { description: row.id } : {},
        }
        candidateSessions.set(candidate, row)
        labels.set(row.id, row.displayTitle)
        return candidate
      }))
    },
    onPick({ candidate }) {
      const row = candidateSessions.get(candidate)
      if (row === undefined) return undefined
      return {
        insert: {
          source: 'session',
          ref: row.id,
          label: row.displayTitle,
          clipboardText: formatSessionReferenceMention(row.id, row.displayTitle),
        },
      }
    },
    codec,
  }

  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => inputTriggers.registerSource(source), 'ui-session-reference: @ source')
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @deepseek-ai/dsh-client-ui-session-reference test` Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/client/ui-session-reference
git commit -m "feat(session-reference): add same-workspace @ session source"
```

---

### Task 6: 装配 Web bundle 与菜单文案

**Files:**
- Modify: `packages/bundle/web-app/package.json`
- Modify: `packages/bundle/web-app/cordis.patch.yml`
- Modify: `packages/client/ui-input-trigger/src/client/locales.ts`

**Interfaces:**
- Consumes: Task 1 / Task 4 的包名与导出。
- Produces: `dsh web` 组合中的三行——`session-reference`、`session-reference-admission`、`ui-session-reference`。

- [ ] **Step 1: 加 workspace 依赖**

在 `packages/bundle/web-app/package.json` 的 `dependencies` 中，按字母序加入：

```json
    "@deepseek-ai/dsh-client-ui-session-reference": "workspace:^",
    "@deepseek-ai/dsh-session-reference": "workspace:^",
    "@deepseek-ai/dsh-session-reference-admission": "workspace:^",
```

- [ ] **Step 2: 加组合行**

在 `packages/bundle/web-app/cordis.patch.yml` 的 host 区（`plugin-inventory` 后）加：

```yaml
    # Cross-session snapshot resolver and its pre-step admission for canonical
    # dsh-session: mentions in direct user messages.
    - id: session-reference
      name: '@deepseek-ai/dsh-session-reference'

    - id: session-reference-admission
      name: '@deepseek-ai/dsh-session-reference-admission'
```

在 browser roster 的 `ui-subagent` 后加：

```yaml
    # '@' source for same-workspace conversation snapshot references.
    - id: ui-session-reference
      name: '@deepseek-ai/dsh-client-ui-session-reference'
```

- [ ] **Step 3: 加 `session` 菜单组文案**

`packages/client/ui-input-trigger/src/client/locales.ts`：

```ts
  'session': '会话',
```

英文侧：

```ts
  'session': 'Sessions',
```

两处都放在 `subagent` 键后，保持字典键序与类型联合同步。

- [ ] **Step 4: 安装依赖并跑受影响测试**

```bash
pnpm install --prefer-offline
pnpm --filter @deepseek-ai/dsh-client-ui-input-trigger test
pnpm --filter @deepseek-ai/dsh-client-ui-session-reference test
pnpm --filter @deepseek-ai/dsh-session-reference-admission test
pnpm --filter @deepseek-ai/dsh-client-ui-session-reference bundle
```

Expected: 全部 PASS。

- [ ] **Step 5: 跑 GUI 检查**

Run: `pnpm run test:gui` Expected: PASS；若存在与本次改动无关的红项，记录并在最终 handoff 说明，不顺手修。

- [ ] **Step 6: 提交**

```bash
git add packages/bundle/web-app/package.json packages/bundle/web-app/cordis.patch.yml packages/client/ui-input-trigger/src/client/locales.ts pnpm-lock.yaml
git commit -m "feat(session-reference): wire admission and @ source into web bundle"
```

---

### Task 7: Web e2e（真实组合：`@` 菜单与 chip 插入）

**Files:**
- Create: `apps/web/tests/session-references.e2e.ts`

**Interfaces:**
- Consumes: `launchWebScaffold`、`seedSession`、`watchConsole`（`apps/web/tests/scaffold.ts`）；`newEnglishPage`、`saveFailureShot`（`apps/web/tests/support.ts`）。

- [ ] **Step 1: 写 e2e（两个同工作区 seed，零模型调用）**

```ts
// Web e2e scenario: the composer '@' session source. Cold-seeds two ordinary
// conversations in the scaffold workspace, opens the current one, types '@',
// picks the source conversation, and verifies the structured chip landed.
// Zero model calls: the scenario never submits a prompt.
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const CURRENT_ID = 'web-session-reference-current'
const SOURCE_ID = 'web-session-reference-source'
const SOURCE_TITLE = 'Handoff source'

/** One settled, titled conversation in the scaffold workspace. */
function conversationFixture(id: string, title: string, text: string): string {
  const session = Session.create(SessionId(id))
  const origin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title,
    messageSeqs: [user.seq],
    source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: `${title} done` }],
      source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return [
    JSON.stringify({
      type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}',
      createdAt: 0, cwd: '{{cwd}}',
    }),
    ...session.events.map(event => JSON.stringify({ ...event, time: origin + event.seq * 1_000 })),
    '',
  ].join('\n')
}

describe('web e2e: composer @ session references', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, conversationFixture(CURRENT_ID, 'Current task', 'current user'), CURRENT_ID)
    await seedSession(scaffold, conversationFixture(SOURCE_ID, SOURCE_TITLE, 'source user'), SOURCE_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('lists the workspace conversation, inserts a chip, and never calls the model', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-session-references'))

    // Open the seeded current conversation the same way other seeded-history
    // scenarios do: expand the workspace group and click its row.
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    if (await groupRow.getAttribute('aria-expanded') !== 'true') await groupRow.click()
    const currentRow = page.getByText('Current task', { exact: true })
    await currentRow.waitFor({ timeout: 10_000 })
    await currentRow.click()

    const composer = page.locator('textarea:enabled').last()
    await composer.click()
    await composer.type('@')
    const menu = page.locator('[role="listbox"]')
    await menu.waitFor({ timeout: 10_000 })
    await page.getByText('会话', { exact: true }).waitFor({ timeout: 5_000 })
    const option = page.locator('[id^="dsh-slash-option-session-"]').first()
    await option.waitFor({ timeout: 5_000 })
    await expect(option).toContainText(SOURCE_TITLE)
    await option.click()

    expect(await composer.inputValue()).toContain('\uFFFC')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
```

- [ ] **Step 2: 构建前端并跑该 e2e**

```bash
pnpm --filter @deepseek-ai/dsh-web-frontend build
DSH_SNAPSHOT=replay pnpm run test:web -- apps/web/tests/session-references.e2e.ts
```

Expected: PASS；如果 `test:web` 参数形式不可用，直接运行 `DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/session-references.e2e.ts`。

- [ ] **Step 3: 提交**

```bash
git add apps/web/tests/session-references.e2e.ts
git commit -m "test(session-reference): cover web @ menu and chip insertion"
```

---

### Task 8: Agent Note、翻译清单排除与最终门禁

**Files:**
- Create: `.agents/notes/implemented/feature/2026-08-16-web-session-references.md`
- Create: `.agents/notes/implemented/feature/2026-08-16-web-session-references.zh.md`
- Create: `.agents/notes/implemented/feature/2026-08-16-web-session-references.i18n.yaml`
- Modify: `scripts/translation-pairing.manifest.json`（本计划中文单文件排除）

**Interfaces:**
- 无新接口；记录已实现决策、被拒方案与验证。

- [ ] **Step 1: 写英文 Agent Note**

```markdown
# Agent Note: Web session references through composer `@`

Status: implemented

## Problem

The Web composer already had an `@` trigger pipeline, and the host already had `@deepseek-ai/dsh-session-reference` for bounded cross-session snapshots, but the Web profile exposed no way to select a workspace conversation and attach its snapshot to a message. Task handoff between conversations required manual copying or resuming the source.

## Decision

Two plugins connect the existing pieces. `@deepseek-ai/dsh-session-reference-admission` registers the outermost `agent/pre-step` listener and parses canonical `dsh-session:` mentions in direct user messages; it calls `ctx.sessionReferenceResolver.prepare`, replaces the direct message with readable `@label` text while preserving id and source, and inserts the snapshot message immediately before it. `@deepseek-ai/dsh-client-ui-session-reference` registers the `@` `session` input-trigger source over the warm `ctx.sessions.list`: same-cwd, non-blank, non-subagent conversations excluding the current session, cap 50, `order: -1`. Picking inserts a structured `ReferenceInsert` chip whose codec serializes the canonical mention.

Failures are fail-closed: malformed mentions, unreadable sources, and budget or limit errors throw from pre-step, so the turn ends with an error card and no partial context. The browser codec revalidates the picked session against a ready list before submit and keeps the draft on early failure.

The Web bundle mounts three rows: `session-reference`, `session-reference-admission`, and `ui-session-reference`. Apiproxy, the wire schema, the input state machine, and `InputTriggerCandidate` stay unchanged.

## Alternatives considered

- **Prepare inside the apiproxy prompt handler** — rejected because it would put Web-specific admission in the core gateway and duplicate the TUI pre-step path.
- **Extend the existing subagent `@` source** — rejected because plain title text cannot identify sessions uniquely and would bypass the canonical URI and snapshot trust boundary.
- **Browser plain-text mentions without chips** — rejected because the input machine's chip path already provides occurrence identity, labels, and codec serialization.

## Consequences

The snapshot remains send-time frozen, read-only, capped, and warned. Pre-step admission means other pre-step listeners observe the raw canonical mention text, and a late source deletion surfaces as a turn error rather than an RPC prompt error. Removing the three bundle rows removes the feature.
```

- [ ] **Step 2: 写中文对侧，结构逐节一致**

中文标题固定为 `# Agent Note: Web session references through composer `@``，`Status: implemented` 原样；正文按术语表翻译，保持所有小节与英文一一对应。

- [ ] **Step 3: 记录配对并加本计划排除**

```bash
pnpm run verify-translation-pairing --write .agents/notes/implemented/feature/2026-08-16-web-session-references.md
```

`scripts/translation-pairing.manifest.json` 在 spec 排除行后加：

```json
    "docs/superpowers/plans/2026-08-16-web-session-references.md"
```

- [ ] **Step 4: 跑最终门禁**

```bash
pnpm run verify-translation-pairing --list
pnpm run verify-agent-note-format
pnpm run verify-md-wrap
pnpm run verify-md-links
pnpm --filter @deepseek-ai/dsh-session-reference-admission test
pnpm --filter @deepseek-ai/dsh-client-ui-session-reference test
pnpm run test:gui
git diff --check
```

Expected: 与本次改动相关的检查全部 PASS；`verify-translation-pairing --list` 中本 spec/plan 显示 excluded，两个新包 README 与 Agent Note 显示 ok。

- [ ] **Step 5: 提交**

```bash
git add .agents/notes/implemented/feature/2026-08-16-web-session-references.md .agents/notes/implemented/feature/2026-08-16-web-session-references.zh.md .agents/notes/implemented/feature/2026-08-16-web-session-references.i18n.yaml scripts/translation-pairing.manifest.json docs/superpowers/plans/2026-08-16-web-session-references.md
git commit -m "docs(session-reference): record shipped web session-reference decision"
```

---

## Self-Review

- Spec coverage：候选范围（Task 5）、chip/codec（Task 4/5）、pre-step 注入与替换（Task 2）、错误与安全（Task 2/3）、装配与文案（Task 6）、Web e2e（Task 7）、Agent Note（Task 8）。
- Placeholder scan：无 TBD/TODO；每个代码步骤包含可执行内容。
- Type consistency：`encodeSessionReferenceUri` / `formatSessionReferenceMention` 在 Task 4 定义、Task 5 使用；`sessionReferenceResolver` 服务名在 Task 1/2/6 一致；`source: 'session'` 与 codec 的 `source` 名一致。
