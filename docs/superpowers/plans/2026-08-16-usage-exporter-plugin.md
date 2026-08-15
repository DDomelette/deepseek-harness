# Usage Exporter Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `@deepseek-ai/dsh-usage-exporter`, a disabled-by-default Host plugin that tails the local usage telemetry JSONL and pushes deterministic batches to the Monitor ingestion endpoint.

**Architecture:** The exporter owns a small tail reader with an offset cursor, a sender with retry classification, and a Cordis apply loop. It never subscribes to `llm/stream` and never changes the capture plugin; `$DSH_HOME/telemetry/usage-*.jsonl` remains the durable source of truth.

**Tech Stack:** TypeScript, Cordis, Schemastery, Node `node:fs/promises`, global `fetch`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-16-dsh-usage-telemetry-push-design.md` (Part B).
**Monitor contract:** TokenMonitor worktree `docs/superpowers/specs/2026-08-16-dsh-usage-ingest-handoff.md`.

## Global Constraints

- Worktree: `/home/huawei/dsh-usage-telemetry-push`, branch `feat/dsh-usage-telemetry-push`.
- Row format is frozen v1; import the validator as `@deepseek-ai/dsh-usage-telemetry/src/schema.ts`, never re-declare it.
- `batchId` is `sha256:<hex>` over `(sourceId, file, startOffset, endOffset)`; retries reuse the same id.
- A batch cursor advances only after `accepted`, `duplicate`, or `permanent` classification.
- The shipped Web bundle entry stays `disabled: true`.
- Bilingual README pair and i18n record are required before the final commit.
- Run tests from the worktree root.

---

### Task 1: Scaffold the package and pin the Config schema

**Files:**
- Create: `packages/telemetry/usage-exporter/package.json`
- Create: `packages/telemetry/usage-exporter/tsconfig.json`
- Create: `packages/telemetry/usage-exporter/src/invariant.ts`
- Create: `packages/telemetry/usage-exporter/src/index.ts`
- Test: `packages/telemetry/usage-exporter/tests/config.spec.ts`
- Modify: `tsconfig.host.json`
- Modify: `packages/bundle/web-app/package.json`

**Interfaces:**
- Consumes: `z` from `@deepseek-ai/schemastery`, `resolveDshHome`/`dshHomePath` from `@deepseek-ai/dsh-home-paths`.
- Produces:
  - `export const name = 'usage-exporter'`
  - `export interface Config { endpoint: string; token: string; sourceId: string; telemetryRoot?: string; cursorPath?: string; pollIntervalMs: number; maxBatchRows: number; maxBatchBytes: number; requestTimeoutMs: number; maxAttempts: number; baseRetryMs: number; maxRetryMs: number; startFrom: 'end' | 'beginning' }`
  - `export const Config` (Schemastery schema) with the defaults in the spec table.
  - `export async function apply(ctx: Context, config: Config): Promise<void>`; the first commit is a schema-only stub that throws `new Error('usage-exporter: apply not implemented yet')` if called, so later tasks replace it.

- [ ] **Step 1: Write the failing config test**

Create `packages/telemetry/usage-exporter/tests/config.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Config, name, apply } from '@deepseek-ai/dsh-usage-exporter'
import { Context } from '@deepseek-ai/cordis'

describe('usage-exporter package surface', () => {
  it('exports the plugin name', () => {
    expect(name).toBe('usage-exporter')
  })

  it('applies defaults and keeps the provided endpoint', () => {
    const resolved = Config({ endpoint: 'http://127.0.0.1:3900/api/v1/dsh/usage' } as never)
    expect(resolved).toMatchObject({
      endpoint: 'http://127.0.0.1:3900/api/v1/dsh/usage',
      token: '',
      sourceId: '',
      pollIntervalMs: 1000,
      maxBatchRows: 200,
      maxBatchBytes: 262144,
      requestTimeoutMs: 10_000,
      maxAttempts: 5,
      baseRetryMs: 1000,
      maxRetryMs: 30_000,
      startFrom: 'end',
    })
  })

  it('rejects an out-of-range batch limit', () => {
    expect(() => Config({ endpoint: 'https://example.test/x', maxBatchRows: 0 } as never)).toThrow()
  })

  it('apply is a stub until the loop task lands', async () => {
    const ctx = new Context()
    await expect(apply(ctx, Config({ endpoint: 'https://example.test/x' } as never))).rejects.toThrow('not implemented')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/telemetry/usage-exporter/tests/config.spec.ts`

Expected: FAIL — package does not exist.

- [ ] **Step 3: Create package manifest**

`packages/telemetry/usage-exporter/package.json`:

```json
{
  "name": "@deepseek-ai/dsh-usage-exporter",
  "description": "Usage exporter: tails the local usage telemetry JSONL and pushes deterministic batches over HTTP",
  "version": "0.1.0-rc.5",
  "publishConfig": { "access": "public" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deepseek-ai/deepseek-harness.git",
    "directory": "packages/telemetry/usage-exporter"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./invariant": { "types": "./lib/types/invariant.d.ts", "default": "./lib/invariant.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "lib/invariant.js", "lib/types/**/*.d.ts"],
  "license": "MIT",
  "dependencies": {
    "@deepseek-ai/schemastery": "workspace:^",
    "zod": "^4.4.3"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "workspace:^",
    "@deepseek-ai/dsh-home-paths": "workspace:^",
    "@deepseek-ai/dsh-invariants": "workspace:^",
    "@deepseek-ai/dsh-usage-telemetry": "workspace:^"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "workspace:^",
    "@deepseek-ai/dsh-home-paths": "workspace:^",
    "@deepseek-ai/dsh-invariants": "workspace:^",
    "@deepseek-ai/dsh-usage-telemetry": "workspace:^"
  }
}
```

`packages/telemetry/usage-exporter/tsconfig.json` (follow `packages/telemetry/usage-telemetry/tsconfig.json`):

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib/types" },
  "include": ["src"],
  "references": [
    { "path": "../../../vendor/cordis" },
    { "path": "../../../vendor/schemastery" },
    { "path": "../../../util/home-paths" },
    { "path": "../../../runtime-diagnostics/invariants" },
    { "path": "../../../telemetry/usage-telemetry" }
  ]
}
```

Add to `tsconfig.host.json` beside usage-telemetry:

```json
{ "path": "./packages/telemetry/usage-exporter" },
```

Add to `packages/bundle/web-app/package.json` `dependencies`:

```json
"@deepseek-ai/dsh-usage-exporter": "workspace:^",
```

- [ ] **Step 4: Implement the schema and invariant**

`src/invariant.ts` (copy the `dsh-usage-telemetry` companion shape, package name `@deepseek-ai/dsh-usage-exporter`, companion name `usage-exporter-invariant`, empty installer with the explanation that the durable relation is asserted by the tail/cursor/sender unit suite):

```ts
/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-usage-exporter'
export const name = 'usage-exporter-invariant'
export const inject = ['invariants']

const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
```

`src/index.ts` schema stub:

```ts
/**
 * Usage exporter: tails the local usage telemetry JSONL and pushes batches.
 * @module @deepseek-ai/dsh-usage-exporter
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export const name = 'usage-exporter'

/** Configuration for one usage ingestion endpoint. */
export interface Config {
  endpoint: string
  token: string
  sourceId: string
  telemetryRoot?: string
  cursorPath?: string
  pollIntervalMs: number
  maxBatchRows: number
  maxBatchBytes: number
  requestTimeoutMs: number
  maxAttempts: number
  baseRetryMs: number
  maxRetryMs: number
  startFrom: 'end' | 'beginning'
}

export const Config: z<Config> = z.object({
  endpoint: z.string().required(),
  token: z.string().default('').role('secret'),
  sourceId: z.string().default(''),
  telemetryRoot: z.string(),
  cursorPath: z.string(),
  pollIntervalMs: z.number().min(250).max(60_000).default(1000),
  maxBatchRows: z.number().step(1).min(1).max(1000).default(200),
  maxBatchBytes: z.number().step(1).min(1024).max(1024 * 1024).default(262_144),
  requestTimeoutMs: z.number().step(1).min(500).max(120_000).default(10_000),
  maxAttempts: z.number().step(1).min(1).max(20).default(5),
  baseRetryMs: z.number().step(1).min(100).max(60_000).default(1000),
  maxRetryMs: z.number().step(1).min(100).max(300_000).default(30_000),
  startFrom: z.union([z.const('end'), z.const('beginning')]).default('end'),
})

/** Replaced by Task 5. */
export async function apply(_ctx: Context, _config: Config): Promise<void> {
  throw new Error('usage-exporter: apply not implemented yet')
}
```

- [ ] **Step 5: Install, run test, commit**

```bash
pnpm install --frozen-lockfile
pnpm vitest run packages/telemetry/usage-exporter/tests/config.spec.ts
```

Expected: PASS.

```bash
git add packages/telemetry/usage-exporter tsconfig.host.json packages/bundle/web-app/package.json pnpm-lock.yaml
git commit -m "feat(usage-exporter): scaffold package and config schema"
```

---

### Task 2: Cursor store

**Files:**
- Create: `packages/telemetry/usage-exporter/src/cursor-store.ts`
- Test: `packages/telemetry/usage-exporter/tests/cursor-store.spec.ts`

**Interfaces:**
- Produces:
  - `export interface FileCursor { offset: number }`
  - `export class CursorStore { constructor(path: string); load(): Promise<void>; get(file: string): FileCursor | undefined; set(file: string, cursor: FileCursor): void; prune(files: ReadonlySet<string>): void; save(): Promise<void> }`

- [ ] **Step 1: Write failing tests**

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CursorStore } from '../src/cursor-store.ts'

describe('CursorStore', () => {
  it('persists cursors atomically and reloads them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-exporter-cursor-'))
    const path = join(dir, 'cursor.json')
    const first = new CursorStore(path)
    await first.load()
    first.set('/tmp/usage-2026-08-16.jsonl', { offset: 42 })
    await first.save()

    const second = new CursorStore(path)
    await second.load()
    expect(second.get('/tmp/usage-2026-08-16.jsonl')).toEqual({ offset: 42 })
    await rm(dir, { recursive: true, force: true })
  })

  it('prunes cursors for files no longer present', async () => {
    const store = new CursorStore(join(tmpdir(), 'usage-exporter-cursor.json'))
    await store.load()
    store.set('a.jsonl', { offset: 1 })
    store.set('b.jsonl', { offset: 2 })
    store.prune(new Set(['a.jsonl']))
    expect(store.get('a.jsonl')).toEqual({ offset: 1 })
    expect(store.get('b.jsonl')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify failure** — module not found.

- [ ] **Step 3: Implement**

```ts
/** Durable tail cursor for the usage telemetry files. */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface FileCursor { offset: number }
interface CursorState { version: 1; files: Record<string, FileCursor> }

export class CursorStore {
  private state: CursorState = { version: 1, files: {} }

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as CursorState
      if (parsed?.version === 1 && typeof parsed.files === 'object' && parsed.files !== null) {
        this.state = parsed
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  get(file: string): FileCursor | undefined {
    return this.state.files[file]
  }

  set(file: string, cursor: FileCursor): void {
    this.state.files[file] = cursor
  }

  prune(files: ReadonlySet<string>): void {
    for (const file of Object.keys(this.state.files)) {
      if (!files.has(file)) delete this.state.files[file]
    }
  }

  async save(): Promise<void> {
    const temp = `${this.path}.tmp`
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(temp, JSON.stringify(this.state), 'utf8')
    await rename(temp, this.path)
  }
}
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry/usage-exporter/src/cursor-store.ts packages/telemetry/usage-exporter/tests/cursor-store.spec.ts
git commit -m "feat(usage-exporter): add durable tail cursor store"
```

---

### Task 3: Tail reader and deterministic batch id

**Files:**
- Create: `packages/telemetry/usage-exporter/src/tail.ts`
- Test: `packages/telemetry/usage-exporter/tests/tail.spec.ts`

**Interfaces:**
- Consumes: `usageRowSchema`/`UsageRow` from `@deepseek-ai/dsh-usage-telemetry/src/schema.ts`, `CursorStore`.
- Produces:
  - `export interface UsageBatch { sourceId: string; batchId: string; file: string; rows: UsageRow[]; startOffset: number; endOffset: number }`
  - `export class UsageTailReader { constructor(options: { root: string; sourceId: string; cursorStore: CursorStore; startFrom: 'end' | 'beginning'; maxBatchBytes: number; maxBatchRows: number; logMalformed(file: string, message: string): void }); nextBatch(): Promise<UsageBatch | undefined> }`
  - `export function batchIdFor(sourceId: string, file: string, startOffset: number, endOffset: number): string`

- [ ] **Step 1: Write failing tests**

```ts
import { appendFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CursorStore } from '../src/cursor-store.ts'
import { batchIdFor, UsageTailReader } from '../src/tail.ts'

const ROW = { v: 1, time: 1786817351458, sessionId: 's', model: 'm', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }

describe('UsageTailReader', () => {
  it('tails from EOF by default and reads only appended rows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'usage-exporter-tail-'))
    const file = join(root, 'usage-2026-08-16.jsonl')
    await writeFile(file, JSON.stringify(ROW) + '\n')
    const cursor = new CursorStore(join(root, 'cursor.json'))
    await cursor.load()
    const reader = new UsageTailReader({ root, sourceId: 'src', cursorStore: cursor, startFrom: 'end', maxBatchBytes: 65536, maxBatchRows: 10, logMalformed: () => {} })

    expect(await reader.nextBatch()).toBeUndefined()

    await appendFile(file, JSON.stringify(ROW) + '\n')
    const batch = await reader.nextBatch()
    expect(batch?.rows).toHaveLength(1)
    expect(batch?.startOffset).toBe(JSON.stringify(ROW).length + 1)
    expect(batch?.batchId).toBe(batchIdFor('src', file, batch.startOffset, batch.endOffset!))
    await rm(root, { recursive: true, force: true })
  })

  it('skips a malformed line and advances past it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'usage-exporter-tail-'))
    await mkdir(root)
    const file = join(root, 'usage-2026-08-16.jsonl')
    await writeFile(file, '{bad\n' + JSON.stringify(ROW) + '\n')
    const malformed: string[] = []
    const reader = new UsageTailReader({ root, sourceId: 'src', cursorStore: await cursor(root), startFrom: 'beginning', maxBatchBytes: 65536, maxBatchRows: 10, logMalformed: (f, m) => { malformed.push(`${f}:${m}`) } })

    const batch = await reader.nextBatch()

    expect(batch?.rows).toHaveLength(1)
    expect(malformed).toHaveLength(1)
    await rm(root, { recursive: true, force: true })
  })
})

async function cursor(root: string): Promise<CursorStore> {
  const store = new CursorStore(join(root, 'cursor.json'))
  await store.load()
  return store
}
```

- [ ] **Step 2: Run tests to verify failure** — module not found.

- [ ] **Step 3: Implement**

```ts
/** Tail reader over the daily usage telemetry JSONL files. */

import { createHash } from 'node:crypto'
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { usageRowSchema, type UsageRow } from '@deepseek-ai/dsh-usage-telemetry/src/schema.ts'
import type { CursorStore } from './cursor-store.ts'

const FILE_PATTERN = /^usage-\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\.jsonl$/

export interface UsageBatch {
  sourceId: string
  batchId: string
  file: string
  rows: UsageRow[]
  startOffset: number
  endOffset: number
}

export function batchIdFor(sourceId: string, file: string, startOffset: number, endOffset: number): string {
  return 'sha256:' + createHash('sha256').update([sourceId, file, String(startOffset), String(endOffset)].join('\0'), 'utf8').digest('hex')
}

export class UsageTailReader {
  constructor(private readonly options: {
    root: string
    sourceId: string
    cursorStore: CursorStore
    startFrom: 'end' | 'beginning'
    maxBatchBytes: number
    maxBatchRows: number
    logMalformed: (file: string, message: string) => void
  }) {}

  async nextBatch(): Promise<UsageBatch | undefined> {
    const { root, sourceId, cursorStore, startFrom, maxBatchBytes, maxBatchRows, logMalformed } = this.options
    const names = (await readdir(root)).filter(name => FILE_PATTERN.test(name)).sort()
    if (names.length === 0) return
    const active = new Set(names)
    cursorStore.prune(active)

    for (const name of names) {
      const file = join(root, name)
      const info = await stat(file)
      let cursor = cursorStore.get(file)
      if (cursor === undefined) {
        cursor = { offset: startFrom === 'end' ? info.size : 0 }
        cursorStore.set(file, cursor)
      } else if (info.size < cursor.offset) {
        cursor = { offset: 0 }
        cursorStore.set(file, cursor)
      }
      if (info.size <= cursor.offset) continue

      const handle = await open(file, 'r')
      try {
        let length = Math.min(info.size - cursor.offset, maxBatchBytes)
        const buffer = Buffer.alloc(length)
        const { bytesRead } = await handle.read(buffer, 0, length, cursor.offset)
        length = bytesRead
        let endOffset = cursor.offset + length
        if (endOffset < info.size) {
          const lastNewline = buffer.lastIndexOf(0x0a)
          if (lastNewline < 0) continue
          endOffset = cursor.offset + lastNewline + 1
        }
        const text = buffer.subarray(0, endOffset - cursor.offset).toString('utf8')
        const rows: UsageRow[] = []
        for (const raw of text.split('\n')) {
          const line = raw.trim()
          if (line.length === 0) continue
          try {
            rows.push(usageRowSchema.parse(JSON.parse(line)))
          } catch (error) {
            logMalformed(file, String(error))
          }
          if (rows.length >= maxBatchRows) break
        }
        return {
          sourceId,
          file,
          rows,
          startOffset: cursor.offset,
          endOffset,
          batchId: batchIdFor(sourceId, file, cursor.offset, endOffset),
        }
      } finally {
        await handle.close()
      }
    }
  }
}
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry/usage-exporter/src/tail.ts packages/telemetry/usage-exporter/tests/tail.spec.ts
git commit -m "feat(usage-exporter): add tail reader with deterministic batches"
```

---

### Task 4: HTTP sender with retry classification

**Files:**
- Create: `packages/telemetry/usage-exporter/src/sender.ts`
- Test: `packages/telemetry/usage-exporter/tests/sender.spec.ts`

**Interfaces:**
- Produces:
  - `export type SendOutcome = { kind: 'accepted'; accepted: number } | { kind: 'duplicate'; duplicates: number } | { kind: 'permanent'; status: number; message: string } | { kind: 'retryable'; status?: number; message: string }`
  - `export class BatchSender { constructor(options: { endpoint: string; token: string; sourceId: string; requestTimeoutMs: number }); send(rows: UsageRow[], batchId: string): Promise<SendOutcome> }`

- [ ] **Step 1: Write failing tests with a local HTTP fixture**

```ts
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { BatchSender } from '../src/sender.ts'
import type { UsageRow } from '@deepseek-ai/dsh-usage-telemetry/src/schema.ts'

let server: Server | undefined
afterEach(async () => { await new Promise<void>(resolve => server?.close(() => resolve())) })

function listen(handler: (req, res, body: string) => void): Promise<number> {
  return new Promise(resolve => {
    server = createServer((req, res) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => { handler(req, res, body) })
    })
    server.listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port))
  })
}

const rows: UsageRow[] = [{ v: 1, time: 1, sessionId: 's', inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }]

describe('BatchSender', () => {
  it('classifies an accepted batch', async () => {
    const port = await listen((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, accepted: 1, duplicates: 0 })) })
    const sender = new BatchSender({ endpoint: `http://127.0.0.1:${port}/api/v1/dsh/usage`, token: '', sourceId: 'src', requestTimeoutMs: 5000 })
    expect(await sender.send(rows, 'sha256:abc')).toEqual({ kind: 'accepted', accepted: 1 })
  })

  it('classifies 401 as permanent and 500 as retryable', async () => {
    const port = await listen((req, res) => {
      if (req.headers.authorization !== 'Bearer t') { res.writeHead(401).end('{}'); return }
      res.writeHead(500).end('{}')
    })
    const sender = new BatchSender({ endpoint: `http://127.0.0.1:${port}/api/v1/dsh/usage`, token: 't', sourceId: 'src', requestTimeoutMs: 5000 })
    expect(await sender.send(rows, 'sha256:abc')).toEqual({ kind: 'retryable', status: 500, message: expect.any(String) })
    const noAuth = new BatchSender({ endpoint: `http://127.0.0.1:${port}/api/v1/dsh/usage`, token: 'wrong', sourceId: 'src', requestTimeoutMs: 5000 })
    expect(await noAuth.send(rows, 'sha256:abc')).toEqual({ kind: 'permanent', status: 401, message: expect.any(String) })
  })
})
```

- [ ] **Step 2: Run tests to verify failure** — module not found.

- [ ] **Step 3: Implement**

```ts
/** HTTP sender for one ingestion endpoint, with outcome classification. */

import type { UsageRow } from '@deepseek-ai/dsh-usage-telemetry/src/schema.ts'

export type SendOutcome =
  | { kind: 'accepted'; accepted: number }
  | { kind: 'duplicate'; duplicates: number }
  | { kind: 'permanent'; status: number; message: string }
  | { kind: 'retryable'; status?: number; message: string }

export class BatchSender {
  constructor(private readonly options: {
    endpoint: string
    token: string
    sourceId: string
    requestTimeoutMs: number
  }) {
    const url = new URL(options.endpoint)
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      throw new Error('usage-exporter: endpoint must use https, or http on loopback')
    }
  }

  async send(rows: UsageRow[], batchId: string): Promise<SendOutcome> {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, this.options.requestTimeoutMs)
    try {
      const response = await fetch(this.options.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.options.token.length > 0 ? { authorization: `Bearer ${this.options.token}` } : {}),
        },
        body: JSON.stringify({ sourceId: this.options.sourceId, batchId, sentAt: Date.now(), rows }),
        signal: controller.signal,
      })
      const message = await response.text().catch(() => '')
      if (response.status >= 200 && response.status < 300) {
        const body = safeJson(message)
        if (body?.ok === true && typeof body.duplicates === 'number' && body.duplicates > 0) {
          return { kind: 'duplicate', duplicates: body.duplicates }
        }
        if (body?.ok === true && typeof body.accepted === 'number') return { kind: 'accepted', accepted: body.accepted }
        return { kind: 'permanent', status: response.status, message: message.slice(0, 500) || 'malformed success body' }
      }
      if (response.status === 400 || response.status === 401 || response.status === 413) {
        return { kind: 'permanent', status: response.status, message: message.slice(0, 500) }
      }
      return { kind: 'retryable', status: response.status, message: message.slice(0, 500) }
    } catch (error) {
      return { kind: 'retryable', message: error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timer)
    }
  }
}

function safeJson(text: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(text) as unknown
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry/usage-exporter/src/sender.ts packages/telemetry/usage-exporter/tests/sender.spec.ts
git commit -m "feat(usage-exporter): add classified HTTP sender"
```

---

### Task 5: Plugin apply loop

**Files:**
- Modify: `packages/telemetry/usage-exporter/src/index.ts`
- Create: `packages/telemetry/usage-exporter/src/apply.ts`
- Test: `packages/telemetry/usage-exporter/tests/apply.spec.ts`

**Interfaces:**
- Consumes: `CursorStore`, `UsageTailReader`, `BatchSender`.
- Produces: the package `apply` now starts polling, retries batches with the same `batchId`, persists acknowledged cursors, and drains the in-flight send on disposal.

- [ ] **Step 1: Write the failing integration test**

```ts
import { createServer, type Server } from 'node:http'
import { appendFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Config, apply } from '@deepseek-ai/dsh-usage-exporter'

let server: Server | undefined
afterEach(async () => { await new Promise<void>(resolve => server?.close(() => resolve())) })

const ROW = { v: 1, time: 1, sessionId: 's', model: 'm', inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

describe('usage-exporter apply', () => {
  it('pushes appended rows and advances the cursor', async () => {
    const received: Array<{ batchId: string; rows: unknown[] }> = []
    const port = await new Promise<number>(resolve => {
      server = createServer((req, res) => {
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          received.push(JSON.parse(body))
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, accepted: received.at(-1)!.rows.length, duplicates: 0 }))
        })
      })
      server.listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port))
    })
    const root = await mkdtemp(join(tmpdir(), 'usage-exporter-apply-'))
    await mkdir(join(root, 'telemetry'), { recursive: true })
    const ctx = new Context()
    ctx.logger.warn = vi.fn() as never
    const fiber = ctx.plugin(
      { name: 'usage-exporter', inject: [] as never, apply },
      Config({ endpoint: `http://127.0.0.1:${port}/api/v1/dsh/usage`, telemetryRoot: join(root, 'telemetry'), cursorPath: join(root, 'cursor.json'), pollIntervalMs: 250 } as never),
    )
    await fiber.await()
    await appendFile(join(root, 'telemetry', 'usage-2026-08-16.jsonl'), JSON.stringify(ROW) + '\n')
    await vi.waitFor(() => { expect(received).toHaveLength(1) }, { timeout: 5000 })
    expect(received[0]!.rows).toEqual([ROW])

    await fiber.dispose()
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify failure** — `apply` still throws `not implemented`.

- [ ] **Step 3: Implement `apply.ts`**

```ts
/** Poll/retry/cursor loop behind the usage exporter plugin. */

import { createHash } from 'node:crypto'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { CursorStore } from './cursor-store.ts'
import { BatchSender } from './sender.ts'
import { UsageTailReader } from './tail.ts'
import type { Config } from './index.ts'

export async function runExporter(ctx: Context, config: Config): Promise<void> {
  const sourceId = config.sourceId.length > 0 ? config.sourceId : defaultSourceId()
  const root = config.telemetryRoot ?? join(resolveDshHome(), 'telemetry')
  const cursor = new CursorStore(config.cursorPath ?? dshHomePath('storages', 'usage-exporter.json'))
  await cursor.load()
  const sender = new BatchSender({ endpoint: config.endpoint, token: config.token, sourceId, requestTimeoutMs: config.requestTimeoutMs })
  const reader = new UsageTailReader({
    root, sourceId, cursorStore: cursor, startFrom: config.startFrom,
    maxBatchBytes: config.maxBatchBytes, maxBatchRows: config.maxBatchRows,
    logMalformed: (file, message) => { ctx.logger.warn(`usage-exporter: skipped malformed row in ${file}: ${message}`) },
  })

  let inFlight: Promise<void> | undefined
  const tick = (): void => {
    if (inFlight !== undefined) return
    inFlight = (async () => {
      const batch = await reader.nextBatch()
      if (batch === undefined) return
      for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
        const outcome = await sender.send(batch.rows, batch.batchId)
        if (outcome.kind === 'accepted' || outcome.kind === 'duplicate') break
        if (outcome.kind === 'permanent') {
          ctx.logger.warn(`usage-exporter: dropping batch ${batch.batchId}: ${outcome.status ?? ''} ${outcome.message}`)
          break
        }
        if (attempt < config.maxAttempts) {
          const delay = Math.min(config.baseRetryMs * 2 ** (attempt - 1), config.maxRetryMs)
          await new Promise(resolve => setTimeout(resolve, delay))
        } else {
          ctx.logger.warn(`usage-exporter: batch ${batch.batchId} still failing; will retry next poll`)
        }
      }
      cursor.set(batch.file, { offset: batch.endOffset })
      await cursor.save()
    })().finally(() => { inFlight = undefined })
  }

  const timer = setInterval(() => { tick() }, config.pollIntervalMs)
  timer.unref()
  ctx.effect(() => () => clearInterval(timer), 'usage-exporter: poll timer')
  ctx.effect(() => async () => { await inFlight }, 'usage-exporter: drain in-flight send')
  void tick()
}

function defaultSourceId(): string {
  const home = resolveDshHome()
  const digest = createHash('sha256').update(`${hostname()}\0${home}`, 'utf8').digest('hex').slice(0, 8)
  return `${hostname()}-${digest}`.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64)
}
```

Replace the stub in `index.ts`:

```ts
import { runExporter } from './apply.ts'

export async function apply(ctx: Context, config: Config): Promise<void> {
  await runExporter(ctx, config)
}
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry/usage-exporter/src/apply.ts packages/telemetry/usage-exporter/src/index.ts packages/telemetry/usage-exporter/tests/apply.spec.ts
git commit -m "feat(usage-exporter): poll, retry, and persist acknowledged batches"
```

---

### Task 6: Mount disabled in the Web bundle and finalize package docs

**Files:**
- Modify: `packages/bundle/web-app/cordis.patch.yml`
- Create: `packages/telemetry/usage-exporter/README.md`, `README.zh.md`, `README.i18n.yaml`
- Create: `.agents/notes/implemented/feature/2026-08-16-usage-exporter.md`, `.zh.md`, `.i18n.yaml`
- Test: `packages/telemetry/usage-exporter/tests/loader-composition.spec.ts`

**Interfaces:**
- Consumes: completed plugin from Task 5.
- Produces: a disabled bundle entry; package documentation; an Agent Note recording the tail/cursor/retry contract.

- [ ] **Step 1: Add the disabled bundle entry**

In `packages/bundle/web-app/cordis.patch.yml`, next to the `usage-telemetry` row add:

```yaml
    # Optional push exporter. The capture core remains the local JSONL;
    # enable this row and configure endpoint/sourceId to push the same rows
    # to DeepSeek Monitor's ingestion endpoint.
    - id: usage-exporter
      name: '@deepseek-ai/dsh-usage-exporter'
      disabled: true
```

- [ ] **Step 2: Add a bundle patch test**

Create `packages/telemetry/usage-exporter/tests/loader-composition.spec.ts`. The real push loop is already covered by `apply.spec.ts`; this test pins the shipped composition contract.

```ts
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

const patchPath = fileURLToPath(new URL('../../../../bundle/web-app/cordis.patch.yml', import.meta.url))

describe('usage-exporter shipped composition', () => {
  it('ships as a disabled web-app entry', async () => {
    const patch = parseYaml(await readFile(patchPath, 'utf8')) as Array<{ id?: string; name?: string; disabled?: boolean }>
    const entry = patch.find(row => row.id === 'usage-exporter')
    expect(entry).toEqual({
      id: 'usage-exporter',
      name: '@deepseek-ai/dsh-usage-exporter',
      disabled: true,
    })
  })
})
```

Add `"yaml": "workspace:^"` to the package `devDependencies` if the package does not already resolve it (other repo packages use the same dependency; `pnpm install` will reconcile).

- [ ] **Step 3: Write README pair**

English README must include: role, usage snippet with `disabled: false`, config table matching `src/index.ts`, Model Experience (none; no model-facing output), KV Cache effect (none), and Known Limitations (default start-from-end; one process per DSH home; permanent 4xx drops a batch while the local file remains for manual backfill). Chinese mirrors the same sections.

Create `README.i18n.yaml` with `pnpm run verify-translation-pairing --write packages/telemetry/usage-exporter/README.md`.

- [ ] **Step 4: Write the Agent Note**

Feature note `.agents/notes/implemented/feature/2026-08-16-usage-exporter.md` records: Problem, Decision (tail local JSONL; offset cursor; deterministic batchId; disabled by default; endpoint contract), Alternatives (in-process event stream rejected because local file is already the durable ordered source), Consequences, Testing, Deferred (backpressure queue, cwd redaction for remote endpoints). Chinese mirror and i18n record.

- [ ] **Step 5: Run package and repo gates**

```bash
pnpm exec tsc -b tsconfig.host.json
pnpm exec oxlint --config .oxlintrc.json packages/telemetry/usage-exporter
pnpm vitest run packages/telemetry/usage-exporter
pnpm run verify-package-invariants
pnpm run verify-package-readme-model-experience
pnpm run verify-package-readme-limitations
pnpm run verify-cordis-catalog
```

Expected: all pass; if `verify-cordis-catalog` reports generated diff, run the generator named in the error and inspect that only the new package row changed.

- [ ] **Step 6: Commit**

```bash
git add packages/bundle/web-app/cordis.patch.yml packages/telemetry/usage-exporter .agents/notes/implemented/feature/2026-08-16-usage-exporter.md .agents/notes/implemented/feature/2026-08-16-usage-exporter.zh.md .agents/notes/implemented/feature/2026-08-16-usage-exporter.i18n.yaml
git commit -m "feat(usage-exporter): mount disabled in web bundle with docs and agent note"
```

---

## Self-review

- Spec coverage: package/config (Task 1), cursor persistence (Task 2), tail/JSONL source-of-truth (Task 3), HTTP contract classification (Task 4), poll/retry/idempotency loop (Task 5), disabled bundle + docs + composition test (Task 6).
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: `UsageBatch`, `batchIdFor`, `SendOutcome`, and `CursorStore` signatures match across Tasks 3–5.
