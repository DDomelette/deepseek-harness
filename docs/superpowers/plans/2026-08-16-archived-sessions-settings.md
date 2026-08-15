# Archived Sessions Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Archived settings page that groups archived sessions by workspace, restores (unarchive + open) them, and permanently deletes them recursively with confirmation.

**Architecture:** Extend the session persistence seam with a serialized delete primitive, implement it in the JSONL and SQLite backends, add `unarchiveSession`/`forgetSession` to the workspace registry, put recursive deletion orchestration in a new `dsh-session-deletion` host plugin, expose `session.delete`/`workspace.unarchiveSession` RPCs, and ship the UI as a new `settings.section` client plugin.

**Tech Stack:** TypeScript, Cordis plugins, Vitest, React 18, `@deepseek-ai/dsh-*` workspace packages, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-16-archived-sessions-settings-design.zh.md`

## Global Constraints

- Work only inside the worktree `/home/huawei/deepseek-harness/.worktrees/archived-sessions-settings` on branch `feat/archived-sessions-settings`.
- Every implementation task is TDD: write the failing test, watch it fail, implement, watch it pass, then commit.
- New packages follow `packages/AGENTS.md`: tsconfig aggregate registration, `invariant` export, bilingual README triplet, and the package checklist.
- Never edit generated `lib/` directories; source tests import `src/`.
- Test commands run with `pnpm exec vitest run <path>`; typecheck with `pnpm exec tsc -b tsconfig.host.json --pretty false` or `tsconfig.client.json`.
- Ignore the four known pre-existing baseline test failures documented at worktree setup (scripts probe, code-runtime worker, real Claude SDK timeouts, usage-telemetry Windows fixture).

---

### Task 1: Register the Chinese-only spec and plan in the pairing exclusion manifest

**Files:**
- Modify: `scripts/translation-pairing.manifest.json`

**Interfaces:**
- Produces: `scripts/translation-pairing.manifest.json` excludes the two Chinese-only `docs/superpowers/` files so `verify-translation-pairing` reports 0 missing.

- [ ] **Step 1: Add the two exact paths to the `excluded` array**

In `scripts/translation-pairing.manifest.json`, change:

```json
  "excluded": [
    ".agents/notes/AGENTS.md",
    ".agents/notes/implemented/AGENTS.md",
    ".agents/notes/implemented/CLAUDE.md",
    "docs/AGENTS.md",
    "docs/cordis-api/inherited.md",
    "docs/i18n/style-samples.md",
    "docs/i18n/terminology.md",
    "docs/i18n/translation-prompt.md"
  ]
```

to:

```json
  "excluded": [
    ".agents/notes/AGENTS.md",
    ".agents/notes/implemented/AGENTS.md",
    ".agents/notes/implemented/CLAUDE.md",
    "docs/AGENTS.md",
    "docs/cordis-api/inherited.md",
    "docs/i18n/style-samples.md",
    "docs/i18n/terminology.md",
    "docs/i18n/translation-prompt.md",
    "docs/superpowers/specs/2026-08-16-archived-sessions-settings-design.zh.md",
    "docs/superpowers/plans/2026-08-16-archived-sessions-settings.md"
  ]
```

- [ ] **Step 2: Verify pairing count returns to 0 missing**

Run:

```bash
pnpm run verify-translation-pairing --list | tail -3
```

Expected: `948 ok, 0 out-of-sync, 0 missing (of 948 in scope)` (counts may shift when new package READMEs arrive in later tasks).

- [ ] **Step 3: Commit**

```bash
git add scripts/translation-pairing.manifest.json
git commit -m "chore: exclude chinese-only archived sessions docs from pairing"
```

---

### Task 2: Add the SessionPersistence delete primitive and shared contract tests

**Files:**
- Modify: `packages/session/session-persistence/src/index.ts`
- Modify: `packages/session/session-persistence/src/coordinator.ts`
- Modify: `packages/session/session-persistence/tests/contract.ts`
- Modify: `packages/session/session-persistence/tests/persistence.spec.ts`
- Modify test doubles: `packages/session-query/session-query/tests/tracing.spec.ts`, `packages/session-query/session-query/tests/session-query.spec.ts`, `packages/session-query/session-query-sqlite/tests/sqlite.spec.ts`, `packages/feedback/message-feedback/tests/helpers.ts`, `packages/session/session-checkpoint-policy/tests/session-checkpoint-policy.spec.ts`

**Interfaces:**
- Consumes: `SessionId` from `@deepseek-ai/dsh-session`, existing `PersistenceBackend`, `PersistenceCoordinator`.
- Produces:
  - `SessionPersistenceNotFoundError` (exported class, `readonly sessionId: SessionId`).
  - `SessionPersistence.delete(id: SessionId): Promise<void>` abstract method.
  - `PersistenceBackend.deleteStored(id: SessionId, signal?: AbortSignal): Promise<boolean>` hook (`true` = deleted materialized storage, `false` = absent).
  - Event `'session-persistence/deleted'` with payload `{ id: SessionId }`.
  - `PersistenceCoordinator.delete(id: SessionId): Promise<void>`.

- [ ] **Step 1: Write the failing shared-contract tests**

In `packages/session/session-persistence/tests/contract.ts`, change `ContractBackend` to expose the context:

```ts
import type { Context } from '@deepseek-ai/cordis'
import { SessionPersistenceNotFoundError } from '../src/index.ts'

export interface ContractBackend {
  persistence: SessionPersistence
  ctx: Context
  dispose: () => Promise<void>
}
```

Append these tests inside `runPersistenceContract` before the closing `})`:

```ts
    it('delete removes a materialized session and emits session-persistence/deleted', async () => {
      const { persistence, ctx, dispose } = await make()
      try {
        const m = meta('delete-me', '/work')
        const seen: string[] = []
        const off = ctx.on('session-persistence/deleted', event => { seen.push(event.id) })
        await persistence.create(m)
        await persistence.append(m.id, oneTurnLog())
        await persistence.delete(m.id)
        expect(seen).toEqual([m.id])
        expect((await persistence.list()).map(header => header.id)).not.toContain(m.id)
        expect((await persistence.listSnapshots()).map(snapshot => snapshot.header.id)).not.toContain(m.id)
        await expect(persistence.load(m.id)).rejects.toThrow()
        off()
      } finally {
        await dispose()
      }
    })

    it('delete cancels an un-materialized create intent and frees the id for reuse', async () => {
      const { persistence, dispose } = await make()
      try {
        const m = meta('delete-intent')
        await persistence.create(m)
        await persistence.delete(m.id)
        await persistence.create(m)
        await persistence.append(m.id, oneTurnLog())
        expect((await persistence.load(m.id)).meta.id).toBe(m.id)
      } finally {
        await dispose()
      }
    })

    it('delete rejects an unknown id with SessionPersistenceNotFoundError', async () => {
      const { persistence, dispose } = await make()
      try {
        await expect(persistence.delete(SessionId('ghost-delete')))
          .rejects.toBeInstanceOf(SessionPersistenceNotFoundError)
      } finally {
        await dispose()
      }
    })

    it('delete serializes with an in-flight append for the same id', async () => {
      const { persistence, dispose } = await make()
      try {
        const m = meta('delete-race', '/work')
        await persistence.create(m)
        await Promise.all([
          persistence.append(m.id, oneTurnLog()),
          persistence.delete(m.id),
        ])
        expect((await persistence.list()).map(header => header.id)).not.toContain(m.id)
      } finally {
        await dispose()
      }
    })
```

- [ ] **Step 2: Run the contract tests to see the failures**

Run:

```bash
pnpm exec vitest run packages/session/session-persistence/tests/persistence.spec.ts
```

Expected: compile failure `Property 'ctx' does not exist` / `delete` missing on `SessionPersistence` and `deleteStored` missing on `PersistenceBackend`.

- [ ] **Step 3: Add the public error and event declaration**

In `packages/session/session-persistence/src/index.ts`, after `SessionPersistenceSnapshot` add:

```ts
/** A delete requested an id this backend neither tracks nor has stored. */
export class SessionPersistenceNotFoundError extends Error {
  constructor(readonly sessionId: SessionId) {
    super(`session "${sessionId}" not found`)
    this.name = 'SessionPersistenceNotFoundError'
  }
}
```

Replace the existing module augmentation block with:

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionPersistence: SessionPersistence
  }
  interface Events {
    /** One stored session log was permanently deleted. */
    'session-persistence/deleted'(event: { id: SessionId }): void
  }
}
```

Add the abstract method to `SessionPersistence` after `readFrom`:

```ts
  /**
   * Permanently delete one session's stored log, serialized with in-flight
   * operations for the same id. An un-materialized create intent is cancelled;
   * an unknown id rejects with {@link SessionPersistenceNotFoundError}.
   * @param id - persisted session to delete.
   */
  abstract delete(id: SessionId): Promise<void>
```

- [ ] **Step 4: Add the backend hook and coordinator orchestration**

In `coordinator.ts`, add `SessionPersistenceNotFoundError` to the type import from `./index.ts`:

```ts
import type { SessionInspection, SessionLocation, SessionPersistenceNotFoundError } from './index.ts'
```

In `PersistenceBackend`, add after `commitRepair`:

```ts
  /**
   * Delete one stored session's physical artifact. Returns `false` when no
   * materialized artifact exists; any non-absence I/O failure propagates.
   */
  deleteStored(id: SessionId, signal?: AbortSignal): Promise<boolean>
```

In `PersistenceCoordinator`, add after `readFrom`:

```ts
  /**
   * Permanently delete one session's stored log on the per-id chain.
   * An un-materialized create intent is cancelled; an id neither tracked nor
   * stored rejects with {@link SessionPersistenceNotFoundError}.
   * @param id - persisted session to delete.
   */
  delete(id: SessionId): Promise<void> {
    return this.serialize(id, () => this.deleteCore(id))
  }

  private async deleteCore(id: SessionId): Promise<void> {
    await this.waitForRetirement(id)
    const state = this.states.get(id)
    if (state === undefined || state.materialized === false) {
      const deleted = await this.backend.deleteStored(id)
      if (state === undefined && !deleted) throw new SessionPersistenceNotFoundError(id)
    } else {
      await this.backend.deleteStored(id)
    }
    this.states.delete(id)
    this.preparations.invalidate(id)
    this.ctx.emit('session-persistence/deleted', { id })
  }
```

- [ ] **Step 5: Implement the two in-memory test backends**

In `packages/session/session-persistence/tests/persistence.spec.ts`:

- `MemoryPersistence` add service delegation and hook:

```ts
  delete(id: SessionId): Promise<void> {
    return this.coordinator.delete(id)
  }

  async deleteStored(id: SessionId, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    return this.store.delete(id)
  }
```

- `ControlledBackend` add:

```ts
  deleteAttempts = 0

  async deleteStored(id: SessionId, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    this.deleteAttempts += 1
    return this.store.delete(id)
  }
```

- In `runPersistenceContract('memory', ...)` return `ctx` alongside `persistence`.

- [ ] **Step 6: Update every other `SessionPersistence` test subclass**

Add the same unsupported method to the classes in:

- `packages/session-query/session-query/tests/tracing.spec.ts`
- `packages/session-query/session-query/tests/session-query.spec.ts`
- `packages/session-query/session-query-sqlite/tests/sqlite.spec.ts`
- `packages/feedback/message-feedback/tests/helpers.ts`
- `packages/session/session-checkpoint-policy/tests/session-checkpoint-policy.spec.ts`

```ts
  delete(_id: SessionId): Promise<void> {
    return Promise.reject(new Error('delete is not supported by this test persistence'))
  }
```

For each factory that calls `runPersistenceContract` (JSONL none, JSONL zstd, SQLite), return `ctx` too:

```ts
  return {
    persistence: ctx.sessionPersistence,
    ctx,
    dispose: async () => { await fiber.dispose() },
  }
```

- [ ] **Step 7: Run the contract suite until green**

```bash
pnpm exec vitest run packages/session/session-persistence/tests/persistence.spec.ts packages/session/session-persistence-jsonl/tests/jsonl.spec.ts packages/session/session-persistence-jsonl/tests/zstd.spec.ts packages/session/session-persistence-sqlite/tests/sqlite.spec.ts
```

Expected: PASS. Note JSONL/SQLite backends do not implement `deleteStored` yet, so their contract runs still fail in this step; the shared in-memory suite is the only green portion. The next two tasks make the backends green.

- [ ] **Step 8: Commit**

```bash
git add packages/session/session-persistence packages/session-query packages/feedback/message-feedback/tests/helpers.ts packages/session/session-checkpoint-policy/tests
git commit -m "feat(session-persistence): add delete primitive and contract"
```

---

### Task 3: Implement JSONL delete

**Files:**
- Modify: `packages/session/session-persistence-jsonl/src/index.ts`
- Test: `packages/session/session-persistence-jsonl/tests/jsonl.spec.ts`
- Test: `packages/session/session-persistence-jsonl/tests/zstd.spec.ts`

**Interfaces:**
- Consumes: `findLog`, `rm`, `isENOENT` already in the backend file.
- Produces: `JsonlSessionPersistence.delete(id)` and `deleteStored(id, signal)`.

- [ ] **Step 1: Write the failing file-specific tests**

In `jsonl.spec.ts` add after the existing file-layout tests:

```ts
  it('delete removes the configured .jsonl artifact and its session from list', async () => {
    const { ctx, dispose } = await backend()
    try {
      const m = meta('delete-file', '/work')
      await ctx.sessionPersistence.create(m)
      await ctx.sessionPersistence.append(m.id, oneTurnLog())
      const location = ctx.sessionPersistence.locate(m)
      if (location === undefined) throw new Error('JSONL backend must expose a location')
      await stat(location.path)
      await ctx.sessionPersistence.delete(m.id)
      await expect(stat(location.path)).rejects.toMatchObject({ code: 'ENOENT' })
      expect((await ctx.sessionPersistence.list()).map(header => header.id)).not.toContain(m.id)
    } finally {
      await dispose()
    }
  })
```

In `zstd.spec.ts` add the same test but named `delete removes the configured .jsonl.zstd artifact`, using the zstd backend factory already in that file.

- [ ] **Step 2: Run and watch the failure**

```bash
pnpm exec vitest run packages/session/session-persistence-jsonl/tests/jsonl.spec.ts packages/session/session-persistence-jsonl/tests/zstd.spec.ts
```

Expected: FAIL with `delete is not a function` / `deleteStored is not a function`.

- [ ] **Step 3: Implement**

In `JsonlSessionPersistence`, add beside `readFrom`:

```ts
  delete(id: SessionId): Promise<void> {
    return this.coordinator.delete(id)
  }
```

Add beside the other backend hooks:

```ts
  async deleteStored(id: SessionId, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    await this.ensureRootEncoding()
    signal?.throwIfAborted()
    const path = await this.findLog(id, signal)
    if (path === undefined) return false
    try {
      await rm(path)
    } catch (error) {
      signal?.throwIfAborted()
      if (isENOENT(error)) return false
      throw error
    }
    return true
  }
```

- [ ] **Step 4: Run the JSONL suites**

```bash
pnpm exec vitest run packages/session/session-persistence-jsonl/tests/jsonl.spec.ts packages/session/session-persistence-jsonl/tests/zstd.spec.ts
```

Expected: PASS, including the shared delete contract for both `none` and `zstd`.

- [ ] **Step 5: Commit**

```bash
git add packages/session/session-persistence-jsonl
git commit -m "feat(session-persistence-jsonl): implement delete"
```

---

### Task 4: Implement SQLite delete

**Files:**
- Modify: `packages/session/session-persistence-sqlite/src/index.ts`
- Test: `packages/session/session-persistence-sqlite/tests/sqlite.spec.ts`

**Interfaces:**
- Consumes: `rowFor`, `this.ready`, `this.db` in the SQLite backend.
- Produces: `SqliteSessionPersistence.delete(id)` and `deleteStored(id, signal)`.

- [ ] **Step 1: Write the failing file-specific test**

In `sqlite.spec.ts` add after the existing row/transaction tests:

```ts
  it('delete removes the sessions row and every events row in one transaction', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const fiber = await ctx.plugin(SqliteSessionPersistence, { path: ':memory:' })
    try {
      const m = meta('delete-sqlite', '/work')
      await ctx.sessionPersistence.create(m)
      await ctx.sessionPersistence.append(m.id, oneTurnLog())
      await ctx.sessionPersistence.delete(m.id)
      const db = openDatabase(':memory:', 'wal')
      const rows = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE id = ?').get(m.id) as { n: number }
      expect(rows.n).toBe(0)
      const events = db.prepare('SELECT COUNT(*) AS n FROM events WHERE session_id = ?').get(m.id) as { n: number }
      expect(events.n).toBe(0)
      db.close()
    } finally {
      await fiber.dispose()
    }
  })
```

- [ ] **Step 2: Run and watch the failure**

```bash
pnpm exec vitest run packages/session/session-persistence-sqlite/tests/sqlite.spec.ts
```

Expected: FAIL with `delete is not a function`.

- [ ] **Step 3: Implement**

In `SqliteSessionPersistence`, add beside `readFrom`:

```ts
  delete(id: SessionId): Promise<void> {
    return this.coordinator.delete(id)
  }
```

Add beside `listSnapshots`:

```ts
  async deleteStored(id: SessionId, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    await this.ready
    signal?.throwIfAborted()
    if (this.rowFor(id) === undefined) return false
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM events WHERE session_id = ?').run(id)
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return true
  }
```

- [ ] **Step 4: Run the SQLite suite**

```bash
pnpm exec vitest run packages/session/session-persistence-sqlite/tests/sqlite.spec.ts
```

Expected: PASS, including the shared delete contract.

- [ ] **Step 5: Commit**

```bash
git add packages/session/session-persistence-sqlite
git commit -m "feat(session-persistence-sqlite): implement delete"
```

---

### Task 5: Add workspace unarchive and forget-session

**Files:**
- Modify: `packages/workspace/workspace/src/index.ts`
- Test: `packages/workspace/workspace/tests/workspace.spec.ts`
- Modify: `packages/workspace/workspace/README.md` and `README.zh.md`
- Re-record: `packages/workspace/workspace/README.i18n.yaml`

**Interfaces:**
- Consumes: existing `enqueueOperation`, `setState`, `requireTable`, entity `detachSession`.
- Produces:
  - `WorkspaceRegistry.unarchiveSession(sessionId: SessionId): Promise<void>` — no-op success for unknown/unarchived ids.
  - `WorkspaceRegistry.forgetSession(sessionId: SessionId): Promise<void>` — removes the id from every workspace record, the archive set, and the header/path indexes.

- [ ] **Step 1: Write the failing tests**

In `workspace.spec.ts`, after the existing archive tests add:

```ts
  it('unarchiveSession removes the id from the archive set and is idempotent', async () => {
    const dir = await makeDir('unarchive-home')
    const result = await harness({ sessions: [header('s1', dir, 100)] })
    await result.registry.archiveSession(SessionId('s1'))
    expect(result.registry.archivedSessionIds).toEqual(['s1'])
    await result.registry.unarchiveSession(SessionId('s1'))
    expect(result.registry.archivedSessionIds).toEqual([])
    await result.registry.unarchiveSession(SessionId('s1'))
    expect(result.registry.archivedSessionIds).toEqual([])
    await result.registry.unarchiveSession(SessionId('never-archived'))
    expect(result.registry.archivedSessionIds).toEqual([])
  })

  it('forgetSession removes archive membership and every workspace account slot', async () => {
    const dir = await makeDir('forget-home')
    const result = await harness({ sessions: [header('s1', dir, 100)] })
    const workspace = result.registry.list()[0]!
    await result.registry.archiveSession(SessionId('s1'))
    await result.registry.forgetSession(SessionId('s1'))
    expect(result.registry.archivedSessionIds).toEqual([])
    expect(workspace.sessionIds).toEqual([])
    await result.registry.forgetSession(SessionId('s1'))
    expect(result.registry.archivedSessionIds).toEqual([])
  })
```

- [ ] **Step 2: Run and watch the failure**

```bash
pnpm exec vitest run packages/workspace/workspace/tests/workspace.spec.ts
```

Expected: FAIL with `registry.unarchiveSession is not a function`.

- [ ] **Step 3: Implement**

In `packages/workspace/workspace/src/index.ts`, add after `archiveSession`:

```ts
  /**
   * Remove one id from the registry-global archive set. Unknown and
   * already-unarchived ids resolve without writing.
   * @param sessionId - session to unarchive.
   */
  unarchiveSession(sessionId: SessionId): Promise<void> {
    return this.enqueueOperation(async () => {
      const state = this.requireState()
      if (!state.archivedSessionIds.includes(sessionId)) return
      await this.setState({
        ...state,
        archivedSessionIds: state.archivedSessionIds.filter(id => id !== sessionId),
      })
    })
  }

  /**
   * Remove one deleted session from every workspace account, the archive set,
   * and the header/path indexes. Unknown ids resolve without writing.
   * @param sessionId - deleted session to forget.
   */
  forgetSession(sessionId: SessionId): Promise<void> {
    return this.enqueueOperation(async () => {
      for (const entity of [...this.entities.values()]) {
        const record = this.requireTable().get(entity.id)
        if (record !== undefined && record.sessionIds.includes(sessionId)) {
          await entity.detachSession(sessionId)
        }
      }
      this.headers.delete(sessionId)
      this.sessionPaths.delete(sessionId)
      this.invalidSessionPaths.delete(sessionId)
      const state = this.requireState()
      if (!state.archivedSessionIds.includes(sessionId)) return
      await this.setState({
        ...state,
        archivedSessionIds: state.archivedSessionIds.filter(id => id !== sessionId),
      })
    })
  }
```

- [ ] **Step 4: Run the workspace suite**

```bash
pnpm exec vitest run packages/workspace/workspace/tests/workspace.spec.ts packages/workspace/workspace/tests/invariant.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Update the bilingual README pair**

In both `README.md` and `README.zh.md`, add one sentence to the workspace API list after the archive sentence:

English:

```md
- `ctx.workspaceRegistry.unarchiveSession(id)` — removes one id from the registry-global archive set; unknown and already-unarchived ids resolve without writing. `ctx.workspaceRegistry.forgetSession(id)` — removes a deleted session from every workspace account, the archive set, and the header/path indexes; unknown ids resolve without writing.
```

Chinese:

```md
- `ctx.workspaceRegistry.unarchiveSession(id)`：从注册表级全局归档集合移除一个 id；未知 id 与已取消归档的 id 直接完成而不写入。`ctx.workspaceRegistry.forgetSession(id)`：把已删除的会话从所有工作区记账、归档集合及 header/path 索引中移除；未知 id 直接完成而不写入。
```

- [ ] **Step 6: Re-record the pair and commit**

```bash
pnpm run verify-translation-pairing --write packages/workspace/workspace/README
git add packages/workspace/workspace
git commit -m "feat(workspace): add unarchiveSession and forgetSession"
```

---

### Task 6: New host plugin `dsh-session-deletion`

**Files:**
- Create: `packages/session/session-deletion/package.json`
- Create: `packages/session/session-deletion/tsconfig.json`
- Create: `packages/session/session-deletion/src/index.ts`
- Create: `packages/session/session-deletion/src/invariant.ts`
- Create: `packages/session/session-deletion/tests/deletion.spec.ts`
- Create: `packages/session/session-deletion/README.md`, `README.zh.md`, `README.i18n.yaml`
- Modify: `tsconfig.host.json` (add `{ "path": "./packages/session/session-deletion" }`)

**Interfaces:**
- Consumes: `sessions`, `sessionPersistence`, optional `workspaceRegistry`; `SessionPersistenceNotFoundError`; `SessionId`.
- Produces:
  - `SessionDeletionError` with `code: 'session-not-found' | 'session-running' | 'session-has-descendants'` and optional `runningSessionIds`.
  - `ctx.sessionDeletion.delete(input: { sessionId: SessionId; recursive: boolean }): Promise<{ deletedSessionIds: SessionId[] }>`.

- [ ] **Step 1: Write the failing service tests**

`packages/session/session-deletion/tests/deletion.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session-persistence'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import SessionDeletionService, { SessionDeletionError } from '@deepseek-ai/dsh-session-deletion'

function header(id: string, parent?: string): SessionHeader {
  return {
    version: 1, id: SessionId(id), createdAt: 1000, cwd: '/work',
    ...parent === undefined ? {} : { parentSession: SessionId(parent) },
  }
}

async function harness(headers: SessionHeader[], live: string[] = []) {
  const ctx = new Context()
  const stored = new Map(headers.map(h => [h.id, h]))
  const deleted: string[] = []
  ctx.provide('sessions', {
    list: () => live.map(id => ({ id: SessionId(id), header: header(id) })),
    get: (id: SessionId) => live.includes(id) ? ({ id }) : undefined,
  })
  ctx.provide('sessionPersistence', {
    list: async () => [...stored.values()],
    delete: async (id: SessionId) => {
      if (!stored.delete(id)) throw new SessionPersistenceNotFoundError(id)
      deleted.push(id)
    },
  })
  const forget = vi.fn(async (_id: SessionId) => {})
  ctx.provide('workspaceRegistry', { forgetSession: forget })
  await ctx.plugin(SessionDeletionService)
  return { ctx, deleted, forget }
}

describe('SessionDeletionService', () => {
  it('deletes leaves before roots and reports the bottom-up order', async () => {
    const { ctx, deleted } = await harness([
      header('root'), header('child', 'root'), header('leaf', 'child'),
    ])
    const result = await ctx.sessionDeletion.delete({ sessionId: SessionId('root'), recursive: true })
    expect(result.deletedSessionIds).toEqual(['leaf', 'child', 'root'])
    expect(deleted).toEqual(['leaf', 'child', 'root'])
  })

  it('refuses any attached cascade member with zero deletion', async () => {
    const { ctx, deleted } = await harness([
      header('root'), header('child', 'root'),
    ], ['child'])
    await expect(ctx.sessionDeletion.delete({ sessionId: SessionId('root'), recursive: true }))
      .rejects.toMatchObject({ code: 'session-running', runningSessionIds: ['child'] })
    expect(deleted).toEqual([])
  })

  it('refuses a non-recursive delete when descendants exist', async () => {
    const { ctx, deleted } = await harness([header('root'), header('child', 'root')])
    await expect(ctx.sessionDeletion.delete({ sessionId: SessionId('root'), recursive: false }))
      .rejects.toMatchObject({ code: 'session-has-descendants' })
    expect(deleted).toEqual([])
  })

  it('maps an unknown target to session-not-found', async () => {
    const { ctx } = await harness([])
    await expect(ctx.sessionDeletion.delete({ sessionId: SessionId('ghost'), recursive: true }))
      .rejects.toMatchObject({ code: 'session-not-found' })
  })

  it('skips already-gone cascade members and forgets each deleted id', async () => {
    const ctx = new Context()
    const stored = new Map([
      [SessionId('root'), header('root')],
      [SessionId('child'), header('child', 'root')],
    ])
    stored.delete(SessionId('child'))
    ctx.provide('sessions', { list: () => [], get: () => undefined })
    ctx.provide('sessionPersistence', {
      list: async () => [...stored.values()],
      delete: async (id: SessionId) => {
        if (id === SessionId('child')) throw new SessionPersistenceNotFoundError(id)
        stored.delete(id)
      },
    })
    const forget = vi.fn(async (_id: SessionId) => {})
    ctx.provide('workspaceRegistry', { forgetSession: forget })
    await ctx.plugin(SessionDeletionService)
    const result = await ctx.sessionDeletion.delete({ sessionId: SessionId('root'), recursive: true })
    expect(result.deletedSessionIds).toEqual(['root'])
    expect(forget.mock.calls.map(call => call[0])).toEqual(['root'])
  })
})
```

- [ ] **Step 2: Run and watch the failure**

```bash
pnpm exec vitest run packages/session/session-deletion/tests/deletion.spec.ts
```

Expected: FAIL, package path cannot resolve.

- [ ] **Step 3: Create the package scaffold**

`package.json`:

```json
{
  "name": "@deepseek-ai/dsh-session-deletion",
  "description": "Recursive session deletion orchestration for the DeepSeek Harness",
  "version": "0.1.0-rc.5",
  "publishConfig": { "access": "public" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deepseek-ai/deepseek-harness.git",
    "directory": "packages/session/session-deletion"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./invariant": { "types": "./lib/types/invariant.d.ts", "default": "./lib/invariant.js" },
    "./types": { "types": "./lib/types/types.d.ts", "default": "./lib/types/types.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "lib/invariant.js", "lib/types/**/*.js", "lib/types/**/*.d.ts"],
  "license": "MIT",
  "peerDependencies": {
    "@deepseek-ai/cordis": "workspace:^",
    "@deepseek-ai/dsh-invariants": "workspace:^",
    "@deepseek-ai/dsh-session": "workspace:^",
    "@deepseek-ai/dsh-session-persistence": "workspace:^",
    "@deepseek-ai/dsh-workspace": "workspace:^"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "workspace:^",
    "@deepseek-ai/dsh-invariants": "workspace:^",
    "@deepseek-ai/dsh-session": "workspace:^",
    "@deepseek-ai/dsh-session-persistence": "workspace:^",
    "@deepseek-ai/dsh-workspace": "workspace:^"
  }
}
```

`tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "lib/types" },
  "include": ["src"],
  "references": [
    { "path": "../../../vendor/cordis" },
    { "path": "../../core/session" },
    { "path": "../session-persistence" },
    { "path": "../../workspace/workspace" },
    { "path": "../../runtime-diagnostics/invariants" }
  ]
}
```

Add `{ "path": "./packages/session/session-deletion" }` to `tsconfig.host.json`.

- [ ] **Step 4: Implement the service**

`src/index.ts`:

```ts
/**
 * Recursive session-deletion orchestration (`ctx.sessionDeletion`). The
 * service owns running checks, descendant closure, leaf-to-root ordering,
 * already-gone resumption, and optional workspace/archive cleanup. It never
 * reaches into the runtime to cancel sessions; callers cancel first.
 * @module @deepseek-ai/dsh-session-deletion
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-workspace'

export type SessionDeletionErrorCode =
  | 'session-not-found'
  | 'session-running'
  | 'session-has-descendants'

export class SessionDeletionError extends Error {
  constructor(
    readonly code: SessionDeletionErrorCode,
    message: string,
    readonly runningSessionIds?: readonly SessionId[],
  ) {
    super(message)
    this.name = 'SessionDeletionError'
  }
}

export interface SessionDeletionInput {
  readonly sessionId: SessionId
  readonly recursive: boolean
}

export interface SessionDeletionResult {
  readonly deletedSessionIds: SessionId[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionDeletion: SessionDeletionService
  }
}

interface SessionIdentity {
  readonly parentSession?: SessionId
}

/** Topological order leaves-first: repeatedly emit an id with no remaining children. */
function leavesFirst(ids: readonly SessionId[], children: ReadonlyMap<SessionId, readonly SessionId[]>): SessionId[] {
  const remaining = new Set(ids)
  const order: SessionId[] = []
  while (remaining.size > 0) {
    const leaf = [...remaining].find(id =>
      !(children.get(id) ?? []).some(child => remaining.has(child)))
    if (leaf === undefined) throw new Error('session lineage contains a cycle; refusing to delete')
    order.push(leaf)
    remaining.delete(leaf)
  }
  return order
}

export default class SessionDeletionService extends Service {
  static inject = ['sessions', 'sessionPersistence']

  constructor(ctx: Context) {
    super(ctx, 'sessionDeletion')
  }

  /**
   * Permanently delete one session and, when `recursive` is true, its
   * descendant subagent sessions leaves-first.
   * @param input - target and recursion switch.
   * @returns the ids durably deleted, in deletion order.
   */
  async delete(input: SessionDeletionInput): Promise<SessionDeletionResult> {
    const { sessionId, recursive } = input
    const identities = new Map<SessionId, SessionIdentity>()
    for (const session of this.ctx.sessions.list()) {
      identities.set(session.id, { parentSession: session.header.parentSession })
    }
    for (const meta of await this.ctx.sessionPersistence.list()) {
      identities.set(meta.id, { parentSession: meta.parentSession })
    }
    if (!identities.has(sessionId)) {
      throw new SessionDeletionError('session-not-found', `session "${sessionId}" does not exist`)
    }

    const closure = new Set<SessionId>()
    const visit = (id: SessionId): void => {
      if (closure.has(id)) return
      closure.add(id)
      const parent = identities.get(id)?.parentSession
      if (parent !== undefined) visit(parent)
    }
    visit(sessionId)
    const children = new Map<SessionId, SessionId[]>()
    for (const id of closure) {
      const parent = identities.get(id)?.parentSession
      if (parent === undefined || !closure.has(parent)) continue
      const siblings = children.get(parent) ?? []
      siblings.push(id)
      children.set(parent, siblings)
    }

    const running = [...closure].filter(id => this.ctx.sessions.get(id) !== undefined)
    if (running.length > 0) {
      throw new SessionDeletionError(
        'session-running',
        `cannot delete running session(s): ${running.join(', ')}`,
        running,
      )
    }
    if (!recursive && closure.size > 1) {
      throw new SessionDeletionError(
        'session-has-descendants',
        `session "${sessionId}" has descendant subagent sessions; pass recursive: true to delete them too`,
      )
    }

    const deletedSessionIds: SessionId[] = []
    for (const id of leavesFirst([...closure], children)) {
      try {
        await this.ctx.sessionPersistence.delete(id)
        deletedSessionIds.push(id)
      } catch (error) {
        if (error instanceof SessionPersistenceNotFoundError) continue
        throw error
      }
      const registry = this.ctx.get('workspaceRegistry')
      await registry?.forgetSession(id)
    }
    return { deletedSessionIds }
  }
}
```

`src/invariant.ts` mirrors the session-persistence invariant companion shape:

```ts
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-deletion`.
 * @module @deepseek-ai/dsh-session-deletion/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-deletion'

export const name = 'session-deletion-invariant'
export const inject = ['invariants']

const install: InvariantInstaller = Object.assign(
  (_ctx: Context, _fail: (message: string) => never) => {
    // No continuously observable invariant: the service's tests pin the
    // orchestration contract, and persistence owns the durable invariant.
  },
  { inject: ['sessionDeletion'] },
)

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
```

- [ ] **Step 5: Write the bilingual README pair**

English `README.md` documents: the service key, `delete` semantics (running refusal, recursive default false, leaf-to-root, already-gone skip, `deletedSessionIds` order), the `session-not-found`/`session-running`/`session-has-descendants` errors, optional `workspaceRegistry.forgetSession` cleanup, and Model Experience (zero model tokens). Chinese `README.zh.md` mirrors it. Keep both under 250 words and use the same headings/lists/code fences so the pairing structural check passes.

- [ ] **Step 6: Run the package tests and typecheck**

```bash
pnpm exec vitest run packages/session/session-deletion/tests/deletion.spec.ts
pnpm exec tsc -b tsconfig.host.json --pretty false
pnpm run verify-translation-pairing --write packages/session/session-deletion/README
```

Expected: PASS / PASS / pair recorded.

- [ ] **Step 7: Commit**

```bash
git add packages/session/session-deletion tsconfig.host.json pnpm-lock.yaml
git commit -m "feat(session-deletion): add recursive session deletion plugin"
```

---

### Task 7: Wire `session.delete` and `workspace.unarchiveSession` through the gateway

**Files:**
- Modify: `packages/host/apiproxy/src/api/sessions.ts`
- Modify: `packages/host/apiproxy/src/api/rpc-map.ts`
- Modify: `packages/host/apiproxy/src/api/sessions.schema.ts`
- Modify: `packages/host/apiproxy/src/api/workspace.ts`
- Modify: `packages/host/apiproxy/src/api/workspace.schema.ts`
- Modify: `packages/host/apiproxy/src/api-proxy.ts`
- Modify: `packages/host/apiproxy/src/fetch/client.ts`
- Modify: `packages/host/apiproxy/src/fetch/handler.ts`
- Modify: `packages/host/apiproxy/package.json`
- Test: `packages/host/apiproxy/tests/rpc-schemas.spec.ts`
- Test: `packages/host/apiproxy/tests/client-handler.spec.ts`
- Test: `packages/host/apiproxy/tests/fetch-carrier.spec.ts`
- Test: new `packages/host/apiproxy/tests/api-proxy-session-delete.spec.ts`

**Interfaces:**
- Consumes: `SessionDeletionError`, `SessionDeletionService` types; `ctx.workspaceRegistry.unarchiveSession`.
- Produces: `session.delete` / `workspace.unarchiveSession` RPC rows, request/value zod schemas, `IApiClient` methods, and cwd-less archived rows in `session.list`.

- [ ] **Step 1: Add the contract rows and write schema tests**

In `api/sessions.ts` add to `SessionsApi`:

```ts
  /**
   * Permanently delete one session and, when `recursive` is true, its
   * descendant subagent sessions leaves-first.
   */
  delete(request: RpcRequest<{ sessionId: SessionId; recursive?: boolean }>):
  Promise<RpcResponse<{ deletedSessionIds: SessionId[] }>>
```

In `api/rpc-map.ts` add `'session.delete': SessionsApi['delete']`.

In `api/workspace.ts` add to `WorkspaceApi`:

```ts
  /**
   * Removes one session from the registry-global archive set. Unknown and
   * already-unarchived ids resolve with the current full archive set.
   */
  unarchiveSession(request: RpcRequest<{ sessionId: SessionId }>):
  Promise<RpcResponse<{ archivedSessionIds: SessionId[] }>>
```

In `api/sessions.schema.ts` add:

```ts
/** session.delete request payload. */
export const sessionDeleteRequestSchema = z.object({
  sessionId: sessionIdSchema,
  recursive: z.boolean().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'session.delete'>>>

/** session.delete response value: ids durably deleted, leaves-first. */
export const sessionDeleteValueSchema = z.object({
  deletedSessionIds: z.array(sessionIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'session.delete'>>>
```

In `api/workspace.schema.ts` add:

```ts
/** workspace.unarchiveSession request payload. */
export const workspaceUnarchiveSessionRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.unarchiveSession'>>>

/** workspace.unarchiveSession response value: the full updated archive set. */
export const workspaceUnarchiveSessionValueSchema = z.object({
  archivedSessionIds: z.array(sessionIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.unarchiveSession'>>>
```

Add rpc-schemas tests:

```ts
  it('session.delete request/value carry recursive and deletedSessionIds', () => {
    expect(sessionDeleteRequestSchema.parse({ sessionId: 's1', recursive: true }))
      .toEqual({ sessionId: 's1', recursive: true })
    expect(sessionDeleteValueSchema.parse({ deletedSessionIds: ['s1'] }))
      .toEqual({ deletedSessionIds: ['s1'] })
  })

  it('workspace.unarchiveSession request/value carry the id and full set', () => {
    expect(workspaceUnarchiveSessionRequestSchema.parse({ sessionId: 's1' }))
      .toEqual({ sessionId: 's1' })
    expect(workspaceUnarchiveSessionValueSchema.parse({ archivedSessionIds: ['s1'] }))
      .toEqual({ archivedSessionIds: ['s1'] })
  })
```

- [ ] **Step 2: Run and watch the compile failure**

```bash
pnpm exec vitest run packages/host/apiproxy/tests/rpc-schemas.spec.ts
```

Expected: FAIL with missing exports/routes.

- [ ] **Step 3: Implement the gateway methods**

In `api-proxy.ts`, import the deletion types and class:

```ts
import type {} from '@deepseek-ai/dsh-session-deletion'
import { SessionDeletionError } from '@deepseek-ai/dsh-session-deletion'
```

Add `session-deletion` to `packages/host/apiproxy/package.json` peer and dev dependencies.

In the `sessions` object after `search`, add:

```ts
      async delete(request) {
        const deletion = ctx.get('sessionDeletion')
        if (deletion === undefined) {
          return err(request, {
            code: 'session-deletion-unavailable',
            message: 'session deletion is unavailable: this deployment does not mount @deepseek-ai/dsh-session-deletion',
            details: {},
          })
        }
        try {
          const { deletedSessionIds } = await deletion.delete({
            sessionId: request.payload.sessionId,
            recursive: request.payload.recursive === true,
          })
          return ok(request, { deletedSessionIds: [...deletedSessionIds] })
        } catch (error) {
          if (error instanceof SessionDeletionError) {
            if (error.code === 'session-not-found') {
              return err(request, {
                code: 'session-not-found',
                message: error.message,
                details: { sessionId: request.payload.sessionId },
              })
            }
            if (error.code === 'session-running') {
              return err(request, {
                code: 'session-running',
                message: error.message,
                details: { runningSessionIds: [...(error.runningSessionIds ?? [])] },
              })
            }
            return err(request, {
              code: 'session-has-descendants',
              message: error.message,
              details: { sessionId: request.payload.sessionId },
            })
          }
          throw error
        }
      },
```

In the `workspace` object after `archiveSession`, add:

```ts
      async unarchiveSession(request) {
        await ctx.workspaceRegistry.unarchiveSession(request.payload.sessionId)
        return ok(request, { archivedSessionIds: [...ctx.workspaceRegistry.archivedSessionIds] })
      },
```

Patch `listVisibleSessionSummaries` so archived cwd-less cold sessions remain visible. Replace the cold filter line:

```ts
      const cold = (await persistence.list(signal))
        .filter(meta => !attached.has(meta.id) && meta.cwd !== undefined)
```

with:

```ts
      const archived = new Set(ctx.workspaceRegistry.archivedSessionIds)
      const cold = (await persistence.list(signal))
        .filter(meta => !attached.has(meta.id) && (meta.cwd !== undefined || archived.has(meta.id)))
```

- [ ] **Step 4: Register the fetch-carrier routes and client methods**

In `fetch/handler.ts`:

- import `sessionDeleteRequestSchema, sessionDeleteValueSchema` and `workspaceUnarchiveSessionRequestSchema, workspaceUnarchiveSessionValueSchema`
- add rows:

```ts
  'session.delete': { schema: sessionDeleteRequestSchema, invoke: (api, r) => api.sessions.delete(r) },
  'workspace.unarchiveSession': { schema: workspaceUnarchiveSessionRequestSchema, invoke: (api, r) => api.workspace.unarchiveSession(r) },
```

In `fetch/client.ts`:

- add the two value-schema rows to `UNARY_VALUE_SCHEMAS`
- add `delete(payload...): Promise<RpcResponse<...>>` to `IApiClient['sessions']`
- add `unarchiveSession(payload...): Promise<RpcResponse<...>>` to `IApiClient['workspace']`
- add concrete methods beside `sessions.cancel` and `workspace.archiveSession`:

```ts
    delete: (payload, signal) => this.callUnary('session.delete', payload, signal),
    unarchiveSession: (payload, signal) => this.callUnary('workspace.unarchiveSession', payload, signal),
```

- [ ] **Step 5: Update the fixture/fake API surfaces**

- `packages/client/connection/src/client/fixture.ts`: add `sessions.delete` and `workspace.unarchiveSession` dispatches, mirroring the existing `archiveSession` rows.
- `packages/client/connection/tests/fake-api.client.ts` and `packages/client/runtime/tests/fake-api.client.ts`: add the same two methods returning `ok({ deletedSessionIds: [payload.sessionId] })` and `ok({ archivedSessionIds: [] })`.
- `packages/test-support/client-runtime/src/workspaces.ts`: add a recorded `unarchiveSession(sessionId)` method whose default removes the id from `archivedSessionIds`, mirroring `archiveSession`.

- [ ] **Step 6: Add gateway behavior tests**

New `packages/host/apiproxy/tests/api-proxy-session-delete.spec.ts` uses the existing `launchGateway`/fixture helpers from `api-proxy-workspace.spec.ts`. Pin:

```ts
  it('session.delete delegates recursive deletion and maps errors', async () => {
    const { api, ctx } = await launch()
    // ctx.sessionDeletion is a stub installed by the test harness.
    await expect(expectOk(await api.sessions.delete(request({
      sessionId: SessionId('s-root'), recursive: true,
    }))).deletedSessionIds).toEqual(['s-leaf', 's-root'])
  })

  it('session.delete reports session-deletion-unavailable without the plugin', async () => {
    const { api } = await launchWithoutDeletion()
    const response = await api.sessions.delete(request({ sessionId: SessionId('s1'), recursive: true }))
    expect(response.result).toMatchObject({ ok: false, error: { code: 'session-deletion-unavailable' } })
  })

  it('session.list retains archived cwd-less cold sessions', async () => {
    const { api, ctx } = await launch()
    await ctx.sessionPersistence.create(meta('cwd-less-archived'))
    await ctx.workspaceRegistry.archiveSession(SessionId('cwd-less-archived'))
    const listed = expectOk(await api.sessions.list(request({})))
    expect(listed.items.some(item => item.sessionId === SessionId('cwd-less-archived'))).toBe(true)
  })

  it('workspace.unarchiveSession removes the id and returns the full set', async () => {
    const { api, ctx } = await launch()
    await ctx.workspaceRegistry.archiveSession(SessionId('s1'))
    const value = expectOk(await api.workspace.unarchiveSession(request({ sessionId: SessionId('s1') })))
    expect(value.archivedSessionIds).toEqual([])
    expect(ctx.workspaceRegistry.archivedSessionIds).toEqual([])
  })
```

- [ ] **Step 7: Run the gateway test set**

```bash
pnpm exec vitest run packages/host/apiproxy/tests/rpc-schemas.spec.ts packages/host/apiproxy/tests/client-handler.spec.ts packages/host/apiproxy/tests/fetch-carrier.spec.ts packages/host/apiproxy/tests/api-proxy-session-delete.spec.ts packages/host/apiproxy/tests/api-proxy-workspace.spec.ts
```

Expected: PASS after updating the test doubles that now miss the two methods.

- [ ] **Step 8: Commit**

```bash
git add packages/host/apiproxy packages/client/connection/src/client/fixture.ts packages/client/connection/tests/fake-api.client.ts packages/client/runtime/tests/fake-api.client.ts packages/test-support/client-runtime/src/workspaces.ts pnpm-lock.yaml
git commit -m "feat(api): add session.delete and workspace.unarchiveSession"
```

---

### Task 8: Host deletion frame and client runtime convergence

**Files:**
- Modify: `packages/host/apiproxy/src/api/events.ts`
- Modify: `packages/host/apiproxy/src/api/events.schema.ts`
- Modify: `packages/host/apiproxy/src/api-proxy.ts`
- Modify: `packages/client/runtime/src/client/contract/sessions.ts`
- Modify: `packages/client/runtime/src/client/contract/workspaces.ts`
- Modify: `packages/client/runtime/src/client/sessions/service.ts`
- Modify: `packages/client/runtime/src/client/sessions/manager.ts`
- Modify: `packages/client/runtime/src/client/workspaces/service.ts`
- Modify: `packages/client/runtime/src/client/workspaces/manager.ts`
- Test: `packages/client/runtime/tests/workspaces-service.client.spec.ts`
- Test: new `packages/client/runtime/tests/session-delete.client.spec.ts`

**Interfaces:**
- Consumes: `session-persistence/deleted` host event; `HostFrame`.
- Produces: `HostFrame` variant `{ type: 'host/session-deleted'; sessionId: SessionId }`; `ISessions.deleteSession(id)`; `IWorkspaces.unarchiveSession(id)`; public `refresh()` on both interfaces.

- [ ] **Step 1: Add the frame type and failing client tests**

In `api/events.ts` add:

```ts
  | { type: 'host/session-deleted'; sessionId: SessionId }
```

and the same zod variant in `api/events.schema.ts`:

```ts
  z.object({ type: z.literal('host/session-deleted'), sessionId: sessionIdSchema }),
```

In the new client test, drive `SessionManager.handleHostEnvelope` with:

```ts
      const envelope = hostFrame({ type: 'host/session-deleted', sessionId: sid('gone') })
      manager.handleHostEnvelope(envelope)
      expect(manager.getListSnapshot().ids).not.toContain(sid('gone'))
```

and pin `sessions.deleteSession`:

```ts
      api.onSessionDelete = payload => Promise.resolve(ok({ deletedSessionIds: [payload.sessionId] }))
      await sessions.deleteSession(sid('gone'))
      expect(api.callsOf('session.delete')).toEqual([{ sessionId: sid('gone'), recursive: true }])
```

and `workspaces.unarchiveSession`:

```ts
      await workspaces.unarchiveSession(sid('s-open'))
      expect(api.callsOf('workspace.unarchiveSession')).toEqual([{ sessionId: sid('s-open') }])
```

- [ ] **Step 2: Run and watch the failures**

```bash
pnpm exec vitest run packages/client/runtime/tests/session-delete.client.spec.ts packages/client/runtime/tests/workspaces-service.client.spec.ts
```

Expected: FAIL with missing frame variant/methods.

- [ ] **Step 3: Publish the frame from the gateway**

In `api-proxy.ts`, inside the host stream disposer array after the `session/disposed` listener add:

```ts
          ctx.on('session-persistence/deleted', ({ id }) => {
            queue.push(frame({ type: 'host/session-deleted', sessionId: id }))
          }),
```

- [ ] **Step 4: Implement client workspaces unarchive**

In `WorkspaceManager`, add after `archiveSession`:

```ts
  async unarchiveSession(sessionId: SessionId): Promise<RpcResult<{ archivedSessionIds: SessionId[] }>> {
    const { result } = await this.api.workspace.unarchiveSession({ sessionId })
    if (result.ok) this.installArchived(result.value.archivedSessionIds)
    return result
  }
```

In `WorkspaceRuntime`, add after `archiveSession`:

```ts
  async unarchiveSession(sessionId: SessionId): Promise<void> {
    const result = await this.manager.unarchiveSession(sessionId)
    if (!result.ok) throw new Error(`session unarchive failed: ${result.error.code}: ${result.error.message}`)
  }
```

In `contract/workspaces.ts`, add `unarchiveSession(sessionId: SessionId): Promise<void>` and `refresh(): Promise<void>` to `IWorkspaces`.

- [ ] **Step 5: Implement client sessions delete**

In `SessionManager`, add after `fork`:

```ts
  async deleteSession(sessionId: SessionId): Promise<RpcResult<{ deletedSessionIds: SessionId[] }>> {
    const result = await this.api.sessions.delete({ sessionId, recursive: true })
    if (result.ok) this.removeDeleted(result.value.deletedSessionIds)
    return result
  }

  private removeDeleted(ids: readonly SessionId[]): void {
    for (const id of ids) {
      this.recordMutation({ kind: 'remove', sessionId: id })
      this.sessions.get(id)?.handleRemoved()
      this.pendingBuffers.delete(id)
      this.pendingInteractions.delete(id)
      this.jobsBySession.delete(id)
      this.projectionStores.delete(id)
      this.updateCatalogActivity(id, false)
    }
  }
```

Add the host-frame case in `SessionManager.handleHostEnvelope` before `host/session-status`:

```ts
      case 'host/session-deleted': {
        this.removeDeleted([frame.sessionId])
        return
      }
```

In `SessionRuntime`, add:

```ts
  async deleteSession(sessionId: SessionId): Promise<void> {
    const result = await this.manager.deleteSession(sessionId)
    if (!result.ok) throw new Error(`session delete failed: ${result.error.code}: ${result.error.message}`)
  }
```

In `contract/sessions.ts`, add `deleteSession(sessionId: SessionId): Promise<void>` and `refresh(): Promise<void>` to `ISessions`.

- [ ] **Step 6: Run client runtime tests and typecheck**

```bash
pnpm exec vitest run packages/client/runtime/tests/session-delete.client.spec.ts packages/client/runtime/tests/workspaces-service.client.spec.ts packages/test-support/client-runtime/tests/runtime.client.spec.tsx
pnpm exec tsc -b tsconfig.client.json --pretty false
```

Expected: PASS / PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/host/apiproxy/src/api/events.ts packages/host/apiproxy/src/api/events.schema.ts packages/host/apiproxy/src/api-proxy.ts packages/client/runtime
git commit -m "feat(runtime): converge sessions and workspaces over deletion and unarchive"
```

---

### Task 9: Client plugin `dsh-client-ui-settings-archived`

**Files:**
- Create: `packages/client/ui-settings-archived/package.json`
- Create: `packages/client/ui-settings-archived/tsconfig.json`
- Create: `packages/client/ui-settings-archived/tsdown.config.ts`
- Create: `packages/client/ui-settings-archived/src/index.ts`
- Create: `packages/client/ui-settings-archived/src/invariant.ts`
- Create: `packages/client/ui-settings-archived/src/css-modules.d.ts`
- Create: `packages/client/ui-settings-archived/src/client/index.ts`
- Create: `packages/client/ui-settings-archived/src/client/ArchivedSection.tsx`
- Create: `packages/client/ui-settings-archived/src/client/ArchivedSection.module.css`
- Create: `packages/client/ui-settings-archived/src/client/derive.ts`
- Create: `packages/client/ui-settings-archived/src/client/locales.ts`
- Test: `packages/client/ui-settings-archived/tests/derive.client.spec.ts`
- Test: `packages/client/ui-settings-archived/tests/apply.client.spec.ts`
- Test: `packages/client/ui-settings-archived/tests/section.client.spec.tsx`
- Modify: `tsconfig.client.json` (add `{ "path": "./packages/client/ui-settings-archived" }`)

**Interfaces:**
- Consumes: standard root props `useSessions` / `useWorkspaces`; `SettingsSectionOwnerProps.close`; `ctx.sessions`, `ctx.workspaces`, `ctx.locale`, `ctx.slots`.
- Produces: `settings.section` entry `id: 'archived'`, `order: 40`; locale namespace `settings.archived`; pure `deriveArchivedGroups`.

- [ ] **Step 1: Write the failing derive tests**

`derive.client.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SessionId, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { deriveArchivedGroups } from '@deepseek-ai/dsh-client-ui-settings-archived/client'

const sid = (value: string): SessionId => value as SessionId
const wid = (value: string): WorkspaceId => value as WorkspaceId

function sessions(rows: Array<[string, number, string?]>): SessionListState {
  return {
    ids: rows.map(([id]) => sid(id)),
    byId: Object.fromEntries(rows.map(([id, updatedAt, cwd]) => [
      sid(id),
      { id: sid(id), displayTitle: `title-${id}`, updatedAt, running: false, blank: false },
      ...cwd === undefined ? {} : [{ cwd } as never],
    ])),
    current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  } as unknown as SessionListState
}

function workspaces(archived: string[], rows: Array<[string, string[]]>): WorkspaceListState {
  return {
    items: rows.map(([id, sessionIds]) => ({
      workspaceId: wid(id), path: `/work/${id}`, title: id, sessionIds: sessionIds.map(sid),
      createdAt: '0', updatedAt: '0',
    })),
    archivedSessionIds: archived.map(sid),
    state: 'idle', phase: 'ready', error: null, baselinesReady: true, recentWorkspaceId: undefined,
  }
}

describe('deriveArchivedGroups', () => {
  it('keeps workspace order, workspace session order, and puts ungrouped last by updatedAt', () => {
    const groups = deriveArchivedGroups(
      sessions([['loose-1', 3], ['loose-2', 9], ['a1', 1], ['a2', 2], ['b1', 5]]),
      workspaces(['loose-1', 'loose-2', 'a1', 'a2', 'b1'], [
        ['ws-a', ['a2', 'a1']],
        ['ws-b', ['b1']],
      ]),
    )
    expect(groups.map(group => [group.key, group.rows.map(row => row.id)])).toEqual([
      ['ws-a', [sid('a2'), sid('a1')]],
      ['ws-b', [sid('b1')]],
      ['ungrouped', [sid('loose-2'), sid('loose-1')]],
    ])
  })

  it('drops empty groups and archived ids missing from session.list', () => {
    const groups = deriveArchivedGroups(
      sessions([['a1', 1]]),
      workspaces(['a1', 'ghost'], [['ws-a', ['a1']], ['ws-empty', []]]),
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]?.rows.map(row => row.id)).toEqual([sid('a1')])
  })
})
```

- [ ] **Step 2: Run and watch the failure**

```bash
pnpm exec vitest run packages/client/ui-settings-archived/tests/derive.client.spec.ts
```

Expected: FAIL, package path cannot resolve.

- [ ] **Step 3: Create the package scaffold**

Copy `package.json`, `tsconfig.json`, `tsdown.config.ts`, `css-modules.d.ts` from `packages/client/ui-settings-skills`, then replace every occurrence of `ui-settings-skills` with `ui-settings-archived` and the package description with `Archived conversations settings section: restore or delete archived sessions`. Keep the same `dsh.client` inject list but replace `sessions`/`remote` with `sessions`/`workspaces` (drop `remote` only if unused). Add the tsconfig reference to `tsconfig.client.json`.

- [ ] **Step 4: Implement the pure derivation**

`src/client/derive.ts`:

```ts
/**
 * Pure projection from the sessions and workspaces baselines into archived
 * groups. Ordering is the product rule: workspace registry order, workspace
 * session order, then Ungrouped by updatedAt descending.
 */

import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'

export interface ArchivedRow {
  readonly id: SessionId
  readonly title: string
  readonly running: boolean
}

export interface ArchivedGroup {
  readonly key: string
  readonly title: string
  readonly rows: readonly ArchivedRow[]
}

export const UNGROUPED_KEY = 'ungrouped'

export function deriveArchivedGroups(
  sessions: SessionListState,
  workspaces: WorkspaceListState,
): ArchivedGroup[] {
  const archived = new Set(workspaces.archivedSessionIds)
  const rowFor = (id: SessionId): ArchivedRow | undefined => {
    const summary = sessions.byId[id]
    if (summary === undefined) return undefined
    return { id, title: summary.displayTitle, running: summary.running }
  }
  const groups: ArchivedGroup[] = []
  const accounted = new Set<SessionId>()
  for (const workspace of workspaces.items) {
    const rows = workspace.sessionIds
      .map(rowFor)
      .filter((row): row is ArchivedRow => row !== undefined && archived.has(row.id))
    if (rows.length === 0) continue
    for (const row of rows) accounted.add(row.id)
    groups.push({ key: workspace.workspaceId, title: workspace.title, rows })
  }
  const loose = workspaces.archivedSessionIds
    .filter(id => !accounted.has(id) && archived.has(id))
    .map(rowFor)
    .filter((row): row is ArchivedRow => row !== undefined)
    .sort((left, right) => right.id === left.id ? 0 : (sessions.byId[right.id]?.updatedAt ?? 0) - (sessions.byId[left.id]?.updatedAt ?? 0))
  if (loose.length > 0) groups.push({ key: UNGROUPED_KEY, title: '', rows: loose })
  return groups
}
```

- [ ] **Step 5: Implement the component**

`src/client/ArchivedSection.tsx`:

```tsx
/**
 * Archived conversations settings section: workspace groups, one row per
 * archived session, restore-first and delete-second actions, and the
 * delete confirmation modal.
 */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button, IconCloseFill14, IconRefreshOutline16, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { deriveArchivedGroups, UNGROUPED_KEY } from './derive.ts'
import type { ArchivedSettingsKey } from './locales.ts'
import css from './ArchivedSection.module.css'

export interface ArchivedSectionInjected {
  restore(sessionId: SessionId): Promise<boolean>
  deleteSession(sessionId: SessionId): Promise<void>
  refresh(): Promise<void>
}

export type ArchivedSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.archived'>
  & InjectFace<ArchivedSectionInjected>

interface DeleteTarget {
  sessionId: SessionId
  title: string
  descendantCount: number
}

export function ArchivedSection(props: ArchivedSectionProps): ReactNode {
  const { useSessions, useWorkspaces, restore, deleteSession, refresh, close, t } = props
  const sessions = useSessions(state => state)
  const workspaces = useWorkspaces(state => state)
  const [busy, setBusy] = useState<ReadonlySet<SessionId>>(new Set())
  const [target, setTarget] = useState<DeleteTarget | undefined>(undefined)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [restoreErrors, setRestoreErrors] = useState<Readonly<Record<string, string>>>({})

  const groups = useMemo(
    () => deriveArchivedGroups(sessions, workspaces),
    [sessions, workspaces],
  )
  const loading = sessions.phase !== 'ready' || !workspaces.baselinesReady
  const descendants = useMemo(() => {
    const byParent = new Map<string, string[]>()
    for (const row of Object.values(sessions.byId)) {
      if (row.parentId === undefined) continue
      const list = byParent.get(row.parentId) ?? []
      list.push(row.id)
      byParent.set(row.parentId, list)
    }
    return (id: SessionId): number => {
      const seen = new Set<string>()
      const walk = (current: string): void => {
        for (const child of byParent.get(current) ?? []) {
          if (!seen.has(child)) { seen.add(child); walk(child) }
        }
      }
      walk(id)
      return seen.size
    }
  }, [sessions.byId])

  const markBusy = (id: SessionId, busyNow: boolean): void => {
    setBusy(current => {
      const next = new Set(current)
      if (busyNow) next.add(id); else next.delete(id)
      return next
    })
  }

  const onRestore = async (id: SessionId): Promise<void> => {
    markBusy(id, true)
    try {
      const opened = await restore(id)
      setRestoreErrors(current => {
        const next = { ...current }
        delete next[id]
        return next
      })
      if (opened) close()
    } catch (error) {
      setRestoreErrors(current => ({
        ...current,
        [id]: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      markBusy(id, false)
    }
  }

  const openDelete = (id: SessionId, title: string): void => {
    setDeleteError(null)
    setTarget({ sessionId: id, title, descendantCount: descendants(id) })
  }

  const onDelete = async (): Promise<void> => {
    if (target === undefined || busy.has(target.sessionId)) return
    setDeleteError(null)
    markBusy(target.sessionId, true)
    try {
      await deleteSession(target.sessionId)
      setTarget(undefined)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error))
    } finally {
      markBusy(target.sessionId, false)
    }
  }

  const confirmBusy = target !== undefined && busy.has(target.sessionId)
  const ungroupedLabel = groups.find(group => group.key === UNGROUPED_KEY) !== undefined ? t('group.ungrouped') : ''

  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      {loading
        ? <p className={css.status}>{t('loading')}</p>
        : workspaces.state === 'error'
          ? (
            <div role="alert">
              <p>{t('loadFailed')}: {workspaces.error?.message ?? ''}</p>
              <Button variant="outline" onClick={() => { void refresh() }}>{t('retry')}</Button>
            </div>
          )
          : groups.length === 0
            ? <p className={css.empty}>{t('empty')}</p>
            : (
              <div aria-live="polite">
                {groups.map(group => (
                  <section key={group.key} aria-labelledby={`archived-group-${group.key}`}>
                    <h3 id={`archived-group-${group.key}`} className={css.groupTitle}>
                      {group.key === UNGROUPED_KEY ? ungroupedLabel : group.title}
                      <span className={css.count}>{String(group.rows.length)}</span>
                    </h3>
                    <ul className={css.list}>
                      {group.rows.map(row => (
                        <li key={row.id} className={css.row}>
                          <span className={css.rowTitle} title={row.title}>{row.title}</span>
                          {row.running ? <span className={css.running}>{t('row.running')}</span> : null}
                          <span className={css.actions}>
                            <Tooltip text={t('row.restore').replace('{name}', row.title)}>
                              <Button
                                variant="outline"
                                aria-label={t('row.restore').replace('{name}', row.title)}
                                disabled={busy.has(row.id)}
                                onClick={() => { void onRestore(row.id) }}
                              >
                                <IconRefreshOutline16 />
                              </Button>
                            </Tooltip>
                            <Tooltip text={row.running ? t('row.runningDeleteDisabled') : t('row.delete').replace('{name}', row.title)}>
                              <Button
                                variant="outline"
                                className={css.deleteButton}
                                aria-label={t('row.delete').replace('{name}', row.title)}
                                aria-disabled={row.running || busy.has(row.id)}
                                disabled={row.running || busy.has(row.id)}
                                onClick={() => { openDelete(row.id, row.title) }}
                              >
                                <IconCloseFill14 />
                              </Button>
                            </Tooltip>
                          </span>
                          {restoreErrors[row.id] === undefined
                            ? null
                            : <p className={css.error} role="alert">{restoreErrors[row.id]}</p>}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
      {target === undefined ? null : (
        <Modal
          open
          onClose={() => { if (!confirmBusy) setTarget(undefined) }}
          aria-labelledby="archived-delete-title"
          aria-describedby="archived-delete-body"
        >
          <h3 id="archived-delete-title">{t('confirm.title')}</h3>
          <p id="archived-delete-body">
            {target.descendantCount > 0
              ? t('confirm.bodyWithDescendants')
                .replace('{title}', target.title)
                .replace('{count}', String(target.descendantCount))
              : t('confirm.bodyNoDescendants').replace('{title}', target.title)}
          </p>
          {deleteError === null ? null : <p className={css.error} role="alert">{deleteError}</p>}
          <div className={css.modalActions}>
            <Button variant="outline" disabled={confirmBusy} onClick={() => { setTarget(undefined) }}>
              {t('confirm.cancel')}
            </Button>
            <Button variant="primary" className={css.dangerButton} disabled={confirmBusy} onClick={() => { void onDelete() }}>
              {t('confirm.delete')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
```

`src/client/index.ts` registers the section:

```ts
/**
 * Archived settings plugin, browser half: the Archived page of the settings
 * shell, with restore and recursive delete actions.
 */

import type { ClientContext, ISessions, IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ArchivedSection, type ArchivedSectionInjected } from './ArchivedSection.tsx'
import { en, zh, type ArchivedSettingsKey } from './locales.ts'

export type { ArchivedSectionInjected, ArchivedSectionProps } from './ArchivedSection.tsx'
export type { ArchivedSettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.archived': ArchivedSettingsKey
  }
}

const NS = 'settings.archived'

export const inject = ['slots', 'locale', 'sessions', 'workspaces']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-archived: copy dictionaries')
  const sessions = ctx.get('sessions') as ISessions
  const workspaces = ctx.get('workspaces') as IWorkspaces
  const t = ctx.locale.bind(NS)
  const injected = (): ArchivedSectionInjected => ({
    restore: async (sessionId) => {
      await workspaces.unarchiveSession(sessionId)
      if (sessions.list.getSnapshot().byId[sessionId] !== undefined) {
        sessions.open(sessionId)
        return true
      }
      return false
    },
    deleteSession: sessionId => sessions.deleteSession(sessionId),
    refresh: async () => {
      await Promise.all([sessions.refresh(), workspaces.refresh()])
    },
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'archived',
    order: 40,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, ArchivedSection))
}
```

- [ ] **Step 6: Add locale dictionaries and CSS**

`src/client/locales.ts` exports `en` and `zh` with the keys used above: `nav`, `title`, `intro`, `empty`, `loading`, `loadFailed`, `retry`, `group.ungrouped`, `row.restore`, `row.delete`, `row.running`, `row.runningDeleteDisabled`, `confirm.title`, `confirm.bodyNoDescendants`, `confirm.bodyWithDescendants`, `confirm.cancel`, `confirm.delete`, `restoreFailed`, `deleteFailed`. Chinese nav/title are `已归档`; English are `Archived`.

`ArchivedSection.module.css` defines `.section`, `.title`, `.intro`, `.status`, `.empty`, `.groupTitle`, `.count`, `.list`, `.row`, `.rowTitle`, `.running`, `.actions`, `.deleteButton`, `.dangerButton`, `.error`, `.modalActions` with flex layout matching the spec: row title left, actions right, delete button red via the danger color token.

- [ ] **Step 7: Write and run component/registration tests**

`apply.client.spec.ts` asserts the slot entry has `{ id: 'archived', order: 40 }` and the locale namespace registers. `section.client.spec.tsx` renders `ArchivedSection` with the test runtime and pins: group order and Ungrouped last, restore click calls `restore` and `close` on `true`, delete click opens the modal, running delete is disabled, duplicate confirm is blocked, failure keeps the modal open, and `aria-label`s contain the row title.

```bash
pnpm exec vitest run packages/client/ui-settings-archived/tests
pnpm exec tsc -b tsconfig.client.json --pretty false
```

Expected: PASS / PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/client/ui-settings-archived tsconfig.client.json pnpm-lock.yaml
git commit -m "feat(ui-settings-archived): add archived conversations settings section"
```

---

### Task 10: Mount both plugins in the web bundle and finish package docs

**Files:**
- Modify: `packages/bundle/web-app/package.json`
- Modify: `packages/bundle/web-app/cordis.patch.yml`
- Create: package README triplets if not already committed in Tasks 6/9 (`README.md`, `README.zh.md`, `README.i18n.yaml` for both new packages)
- Re-record pairing records for those READMEs

**Interfaces:**
- Consumes: package names `@deepseek-ai/dsh-session-deletion` and `@deepseek-ai/dsh-client-ui-settings-archived`.
- Produces: shipped web composition rows `session-deletion` (host) and `ui-settings-archived` (client).

- [ ] **Step 1: Add dependencies**

In `packages/bundle/web-app/package.json`, add to dependencies:

```json
    "@deepseek-ai/dsh-session-deletion": "workspace:^",
    "@deepseek-ai/dsh-client-ui-settings-archived": "workspace:^",
```

- [ ] **Step 2: Add composition rows**

In `cordis.patch.yml`, after the `workspace` host row add:

```yaml
    - id: session-deletion
      name: '@deepseek-ai/dsh-session-deletion'
```

After the `ui-settings-skills` client row add:

```yaml
    - id: ui-settings-archived
      name: '@deepseek-ai/dsh-client-ui-settings-archived'
```

- [ ] **Step 3: Finish bilingual package READMEs**

For each new package, write/verify `README.md`, `README.zh.md`, and run:

```bash
pnpm run verify-translation-pairing --write packages/session/session-deletion/README packages/client/ui-settings-archived/README
```

README content must state config, semantics, limitations, extension points, and Model Experience (zero prompt/token effects for both; the client page is user-visible only).

- [ ] **Step 4: Run package and composition-level checks**

```bash
pnpm install --offline --prefer-offline
pnpm exec tsc -b tsconfig.host.json --pretty false
pnpm exec tsc -b tsconfig.client.json --pretty false
pnpm exec vitest run packages/session/session-deletion packages/client/ui-settings-archived packages/host/apiproxy packages/client/runtime packages/workspace/workspace
pnpm run verify-md-wrap
pnpm run verify-md-links
```

Expected: all pass; known baseline failures in unrelated packages stay excluded from this command set.

- [ ] **Step 5: Commit**

```bash
git add packages/bundle/web-app pnpm-lock.yaml packages/session/session-deletion/README* packages/client/ui-settings-archived/README*
git commit -m "feat(web-app): mount session-deletion and archived settings plugins"
```

---

### Task 11: Assembled web e2e scenario and final verification

**Files:**
- Create: `apps/web/tests/archived-sessions-settings.e2e.ts`
- Create snapshot as needed: `apps/web/tests/snapshots/archived-sessions-settings/…`

**Interfaces:**
- Consumes: the assembled web scaffold helpers `launchWebScaffold`, `seedSession`, `newEnglishPage`, `watchConsole`; host `workspaceRegistry`, `sessionPersistence`.
- Produces: one zero-model e2e scenario pinning archive → list → restore → archive → recursive delete.

- [ ] **Step 1: Write the scenario**

Use the `workspace-management.e2e.ts` scaffold shape. Core flow:

```ts
  it('archives, lists, restores, and recursively deletes a session from settings', async () => {
    // Seed one cold session and account it under a workspace, then archive it.
    await seedSession(scaffold, seed, 'archived-e2e')
    const workspace = await scaffold.ctx.workspaceRegistry.resolveByPath(scaffold.workspaceCwd)
    if (workspace === undefined) throw new Error('workspace not registered')
    await workspace.attachSession(SessionId('archived-e2e'))
    await scaffold.ctx.workspaceRegistry.archiveSession(SessionId('archived-e2e'))

    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: /Settings|设置/ }).click()
    await page.getByRole('button', { name: 'Archived' }).click()

    // The archived page lists the session under the workspace group.
    const row = page.getByRole('listitem').filter({ hasText: 'archived-e2e' })
    await row.waitFor({ timeout: 10_000 })

    // Restore opens the session and closes settings.
    await row.getByRole('button', { name: /Restore conversation|恢复对话/ }).click()
    await expect.poll(() => scaffold.ctx.workspaceRegistry.archivedSessionIds.length).toBe(0)
    await expect.poll(() => page.getByRole('dialog', { name: /Settings|设置/ }).count()).toBe(0)

    // Archive again through the host, reopen settings, and delete recursively.
    await scaffold.ctx.workspaceRegistry.archiveSession(SessionId('archived-e2e'))
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('button', { name: /Settings|设置/ }).click()
    await page.getByRole('button', { name: 'Archived' }).click()
    await row.getByRole('button', { name: /Delete conversation|删除对话/ }).click()
    const dialog = page.getByRole('dialog', { name: /Delete conversation|删除对话/ })
    await dialog.getByRole('button', { name: /Delete|删除/ }).click()
    await expect.poll(() => page.getByRole('dialog', { name: /Delete conversation|删除对话/ }).count()).toBe(0)

    const headers = await scaffold.ctx.sessionPersistence.list()
    expect(headers.some(header => header.id === SessionId('archived-e2e'))).toBe(false)
    expect(scaffold.ctx.workspaceRegistry.archivedSessionIds).not.toContain(SessionId('archived-e2e'))
    expect(workspace.sessionIds).not.toContain(SessionId('archived-e2e'))
  })
```

Add a second test seeding a child session with `parentSession` in its header, deleting the archived parent with `recursive: true`, and asserting both logs are gone.

- [ ] **Step 2: Run the e2e scenario**

```bash
pnpm exec vitest run apps/web/tests/archived-sessions-settings.e2e.ts
```

Expected: PASS; record snapshots with the repo's web snapshot mode when the scaffold reports new golden files.

- [ ] **Step 3: Run the final gates**

```bash
pnpm run verify-md-wrap
pnpm run verify-md-links
pnpm run verify-translation-pairing --list | tail -3
git diff --check
```

Expected: wrap and links pass; pairing reports 0 missing (new READMEs are paired, spec/plan are excluded).

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/archived-sessions-settings.e2e.ts apps/web/tests/snapshots/archived-sessions-settings
git commit -m "test(web): cover archived session restore and recursive delete end to end"
```

---

## Self-Review

**Spec coverage:**
- Archived settings section grouped by workspace, Ungrouped last → Task 9 `deriveArchivedGroups`.
- Restore = unarchive + open + close settings; missing target stays on page → Task 9 `ArchivedSection` and `client/index.ts`.
- Delete = permanent recursive, running refused, confirmation with descendant count → Tasks 2-4, 6-9.
- Plugin form, no shell edits → Tasks 6, 9, 10.
- cwd-less archived rows retained in `session.list` → Task 7 list patch.
- `session-persistence/deleted` and `host/session-deleted` convergence → Tasks 2, 8.
- Error vocabulary and duplicate-submit/disabled states → Tasks 6-9.
- Pairing exclusion for the Chinese-only spec and plan → Task 1.

**Placeholder scan:** No TBD/TODO/"implement later" strings remain; every code step names real files and signatures.

**Type consistency:** `SessionPersistenceNotFoundError`, `deleteStored`, `sessionDeletion.delete`, `unarchiveSession`, `forgetSession`, `deleteSession`, `deriveArchivedGroups`, and `ArchivedSectionInjected` use one spelling throughout the tasks and match the committed spec.
