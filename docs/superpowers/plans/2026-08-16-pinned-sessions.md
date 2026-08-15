# Pinned Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, plugin-delivered pinned-sessions section to the sidebar workspace browser, with row pin actions, manual ordering, view-following, and search priority.

**Architecture:** A generic host-side session-flags capability feeds `workspace.list`; a host `dsh-session-pins` plugin persists the pin set in its own storage domain and exposes a Typert Remote; a client plugin renders the pinned section, row pin buttons, and search badges through three new child slots declared by `ui-workspace`.

**Tech Stack:** TypeScript, React 18, Cordis Services, zod, storage-domain, Typert Remote, Vitest + Testing Library, pnpm workspaces.

**Spec:** `../specs/2026-08-16-pinned-sessions-design.zh.md`

## Global Constraints

- Worktree: `/home/huawei/deepseek-harness/.worktrees/pinned-sessions`, branch `feat/pinned-sessions`.
- Node `22.19+` or `24+`; package manager is Corepack-pinned `pnpm@11.7.0`; run commands from the worktree root.
- New packages obey `packages/AGENTS.md` and `docs/cookbook/adding-a-package.md`: package tsconfig extends the correct aggregate base, `src/types.ts` stays types-only, tests live under `tests/`, `./invariant` is registered, `@deepseek-ai/cordis` appears in both peer and dev dependencies, and client plugins declare `dsh.client`.
- New package READMEs are bilingual pairs with `## Model Experience` and `## Known Limitations and Deferred Work` sections; create the pair and run `pnpm run verify-translation-pairing --write <pair>`.
- The feature spec and this plan stay single files per user instruction. Register both paths in `scripts/translation-pairing.manifest.json` `excluded` so `doc-sync` does not demand pairs.
- Session ids use the branded `SessionId` from `@deepseek-ai/dsh-session`; never compare to raw strings in host code.
- Every mutation writes the domain first and returns the complete `SessionPinsSnapshot` only after durability.
- Product-visible GUI changes require a real-composition test and a GIF recorded from the real web server.

---

### Task 1: `@deepseek-ai/dsh-session-flags` host package

**Files:**
- Create: `packages/session/session-flags/package.json`
- Create: `packages/session/session-flags/tsconfig.json`
- Create: `packages/session/session-flags/src/types.ts`
- Create: `packages/session/session-flags/src/index.ts`
- Create: `packages/session/session-flags/src/invariant.ts`
- Create: `packages/session/session-flags/tests/session-flags.spec.ts`
- Create: `packages/session/session-flags/README.md`
- Create: `packages/session/session-flags/README.zh.md`
- Modify: `tsconfig.host.json` (add reference)

**Interfaces:**
- Consumes: `SessionId` from `@deepseek-ai/dsh-session`.
- Produces: `SessionFlags`, `SessionFlagProvider`, `SessionFlagsSnapshot`, `SessionFlagRegistry` (default export), `ctx.sessionFlags`.

- [ ] **Step 1: Create package.json**

Copy the shape of `packages/session/session-stats/package.json` with these exact fields:

```json
{
  "name": "@deepseek-ai/dsh-session-flags",
  "description": "Generic per-session presentation flags registry for the DeepSeek Harness",
  "version": "0.1.0-rc.5",
  "publishConfig": { "access": "public" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deepseek-ai/deepseek-harness.git",
    "directory": "packages/session/session-flags"
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
  "files": [
    "lib/index.js",
    "lib/invariant.js",
    "lib/types/**/*.js",
    "lib/types/**/*.d.ts"
  ],
  "license": "MIT",
  "peerDependencies": {
    "@deepseek-ai/dsh-session": "workspace:^",
    "@deepseek-ai/dsh-invariants": "workspace:^",
    "@deepseek-ai/cordis": "workspace:^"
  },
  "devDependencies": {
    "@deepseek-ai/dsh-session": "workspace:^",
    "@deepseek-ai/dsh-invariants": "workspace:^",
    "@deepseek-ai/cordis": "workspace:^"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib/types"
  },
  "include": ["src"],
  "references": [
    { "path": "../../../vendor/cordis" },
    { "path": "../../runtime-diagnostics/invariants" },
    { "path": "../../core/session" }
  ]
}
```

- [ ] **Step 3: Add the tsconfig.host.json reference**

In `tsconfig.host.json`, under `references`, add:

```json
{ "path": "./packages/session/session-flags" }
```

- [ ] **Step 4: Write the failing service test first**

`packages/session/session-flags/tests/session-flags.spec.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionFlagRegistry, { type SessionFlagProvider } from '../src/index.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

async function harness(providers: SessionFlagProvider[]) {
  ctx = new Context()
  await ctx.plugin(SessionFlagRegistry)
  return ctx.sessionFlags
}

describe('session flags registry', () => {
  it('merges providers with later providers winning per session key', async () => {
    const registry = await harness([
      { id: 'a', list: () => ({ [SessionId('s1')]: { pinned: true } }) },
      { id: 'b', list: () => ({ [SessionId('s1')]: { pinned: false }, [SessionId('s2')]: { pinned: true } }) },
    ])
    expect(registry.snapshot()).toEqual({
      flags: {
        [SessionId('s1')]: { pinned: false },
        [SessionId('s2')]: { pinned: true },
      },
      complete: true,
    })
  })

  it('keeps the last good snapshot when a provider fails and removes providers on dispose', async () => {
    const failing: SessionFlagProvider = { id: 'failing', list: () => { throw new Error('boom') } }
    const registry = await harness([
      { id: 'ok', list: () => ({ [SessionId('s1')]: { pinned: true } }) },
      failing,
    ])
    expect(registry.snapshot()).toEqual({
      flags: { [SessionId('s1')]: { pinned: true } },
      complete: true,
    })
    const dispose = registry.registerProvider(failing)
    dispose()
    expect(registry.snapshot().complete).toBe(true)
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm vitest run packages/session/session-flags/tests/session-flags.spec.ts`
Expected: FAIL with module-resolution errors for `../src/index.ts` because the source does not exist yet.

- [ ] **Step 6: Write `src/types.ts`**

```ts
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Open presentation flags attached to one session. */
export interface SessionFlags {
  readonly pinned?: boolean
}

/** Supplies flags for sessions the provider owns. */
export interface SessionFlagProvider {
  readonly id: string
  list(): Readonly<Record<SessionId, SessionFlags>>
}

/** Merged provider projection. `complete` is false after any provider failure. */
export interface SessionFlagsSnapshot {
  readonly flags: Readonly<Record<SessionId, SessionFlags>>
  readonly complete: boolean
}
```

- [ ] **Step 7: Write `src/index.ts`**

```ts
import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionFlagProvider, SessionFlags, SessionFlagsSnapshot } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionFlags: SessionFlagRegistry
  }
}

/** Merges presentation-flag providers in registration order; later providers win per key. */
export class SessionFlagRegistry extends Service {
  private readonly providers: SessionFlagProvider[] = []
  private lastGood: SessionFlagsSnapshot = { flags: {}, complete: true }

  constructor(ctx: Context) {
    super(ctx, 'sessionFlags')
  }

  /** Register one provider; the returned disposer removes it. */
  registerProvider(provider: SessionFlagProvider): () => void {
    if (this.providers.some(entry => entry.id === provider.id)) {
      throw new Error(`duplicate session flag provider "${provider.id}"`)
    }
    this.providers.push(provider)
    return () => {
      const index = this.providers.indexOf(provider)
      if (index !== -1) this.providers.splice(index, 1)
    }
  }

  /** Merge every provider now; a failing provider keeps the last good projection. */
  snapshot(): SessionFlagsSnapshot {
    const flags: Record<SessionId, SessionFlags> = {}
    let complete = true
    for (const provider of this.providers) {
      let next: Readonly<Record<SessionId, SessionFlags>>
      try {
        next = provider.list()
      } catch (error) {
        complete = false
        this.ctx.logger.warn(`session flag provider "${provider.id}" failed: ${String(error)}`)
        continue
      }
      for (const [id, value] of Object.entries(next)) {
        flags[id as SessionId] = { ...flags[id as SessionId], ...value }
      }
    }
    const snapshot = { flags, complete }
    if (complete) this.lastGood = snapshot
    else if (this.lastGood.complete) return this.lastGood
    return snapshot
  }
}

export default SessionFlagRegistry
```

- [ ] **Step 8: Write `src/invariant.ts`**

Copy `packages/session/session-stats/src/invariant.ts`, replace the package name with `@deepseek-ai/dsh-session-flags` and the companion name with `session-flags-invariant`, and use this installer rationale:

```ts
/**
 * No runtime invariant: the package owns provider registration and a pure
 * merge projection with no durable state; provider failures are contained
 * by the last-good snapshot path.
 */
const install: InvariantInstaller = () => {}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm install`
Run: `pnpm vitest run packages/session/session-flags/tests/session-flags.spec.ts`
Expected: PASS

- [ ] **Step 10: Write bilingual READMEs and record the pair**

Create `README.md` with sections: `# @deepseek-ai/dsh-session-flags`, Service API (`registerProvider`, `snapshot`), merge semantics, failure semantics, then the canonical Model Experience block stating zero direct model tokens and independent KV cache, and:

```markdown
## Known Limitations and Deferred Work

- **No provider change notification** — consumers pull `snapshot()` at their own boundary; future providers that change independently must publish their own event.
```

Create `README.zh.md` as a faithful translation. Run:

```bash
pnpm run verify-translation-pairing --write packages/session/session-flags/README
```

- [ ] **Step 11: Commit**

```bash
git add packages/session/session-flags tsconfig.host.json pnpm-lock.yaml
git commit -m "feat(session-flags): add generic per-session flags registry"
```

---

### Task 2: `@deepseek-ai/dsh-session-pins` host plugin (domain + Remote)

**Files:**
- Create: `packages/session/session-pins/package.json`
- Create: `packages/session/session-pins/tsconfig.json`
- Create: `packages/session/session-pins/src/types.ts`
- Create: `packages/session/session-pins/src/spec.ts`
- Create: `packages/session/session-pins/src/index.ts`
- Create: `packages/session/session-pins/src/invariant.ts`
- Create: `packages/session/session-pins/tests/session-pins.spec.ts`
- Create: `packages/session/session-pins/README.md`
- Create: `packages/session/session-pins/README.zh.md`
- Modify: `tsconfig.host.json`

**Interfaces:**
- Consumes: `ctx.storageDomain`, `ctx.sessionFlags`, `SessionId`.
- Produces: `ctx.sessionPins`, generated `remote.sessionPins` with `list`, `setPinned`, `reorderGroup`, `reorderFlat`.

- [ ] **Step 1: Create package.json**

Use `packages/host/plugin-inventory/package.json` as the template with these differences: name `@deepseek-ai/dsh-session-pins`, description `Pinned-sessions persistence and Remote API for the DeepSeek Harness`, repository directory `packages/session/session-pins`, no `@deepseek-ai/dsh-brand` dependency, add dependencies `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-session-flags`, `@deepseek-ai/dsh-storage-domain`, `zod`, and keep `@deepseek-ai/dsh-typert-protocol` / `@deepseek-ai/cordis` / `@deepseek-ai/dsh-invariants` in peer/dev as in the template. Exports include `./types`, `./typert`, and `./remote`; `files` matches the template plus `lib/types/**/*.js`.

- [ ] **Step 2: Create tsconfig.json**

Use `packages/host/plugin-inventory/tsconfig.json` as the template; references are `../../../vendor/cordis`, `../../../vendor/schemastery`, `../../runtime-diagnostics/invariants`, `../../core/session`, `../../storage/storage-domain`, and `../session-flags`.

- [ ] **Step 3: Add tsconfig.host.json reference**

Add `{ "path": "./packages/session/session-pins" }` next to the session-flags reference.

- [ ] **Step 4: Write `src/types.ts` (types only)**

```ts
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Complete pin state returned by every Remote method. */
export interface SessionPinsSnapshot {
  readonly pinnedSessionIds: readonly SessionId[]
  readonly groupOrder: Readonly<Record<string, readonly SessionId[]>>
  readonly flatOrder: readonly SessionId[]
}
```

- [ ] **Step 5: Write `src/spec.ts`**

```ts
import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'

const sessionIds = z.array(z.string().transform(SessionId))

const sessionPinsDomainState = z.object({
  pinnedSessionIds: sessionIds.default([]),
  groupOrder: z.record(z.string(), sessionIds).default({}),
  flatOrder: sessionIds.default([]),
})

export type SessionPinsDomainState = z.infer<typeof sessionPinsDomainState>

export const sessionPinsDomainSpec = defineDomain({
  name: 'session-pins',
  version: 1,
  global: {
    schema: sessionPinsDomainState,
    initial: { pinnedSessionIds: [], groupOrder: {}, flatOrder: [] },
  },
  tables: {},
})
```

- [ ] **Step 6: Write `src/index.ts`**

```ts
import { Context, Service } from '@deepseek-ai/cordis'
import type { DomainGlobal } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { sessionPinsDomainSpec, type SessionPinsDomainState } from './spec.ts'
import type { SessionPinsSnapshot } from './types.ts'

export type * from './types.ts'
export { sessionPinsDomainSpec } from './spec.ts'

/** Duplicated or unknown ids in a reorder request. */
export class SessionPinsInvalidError extends Error {
  constructor(readonly sessionIds: readonly SessionId[]) {
    super(`session-pins-invalid: ${sessionIds.join(', ')}`)
    this.name = 'SessionPinsInvalidError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionPins: SessionPinsService
  }
}

const cloneOrder = (order: Readonly<Record<string, readonly SessionId[]>>): Record<string, SessionId[]> =>
  Object.fromEntries(Object.entries(order).map(([key, ids]) => [key, [...ids]]))

const snapshotOf = (state: SessionPinsDomainState): SessionPinsSnapshot => ({
  pinnedSessionIds: [...state.pinnedSessionIds],
  groupOrder: Object.fromEntries(Object.entries(state.groupOrder).map(([key, ids]) => [key, [...ids]])),
  flatOrder: [...state.flatOrder],
})

/** Durable pin set plus its Typert Remote. */
export class SessionPinsService extends TypertRemoteService {
  static inject = ['storageDomain', 'sessionFlags']

  private global?: DomainGlobal<SessionPinsDomainState>

  constructor(ctx: Context) {
    super(ctx, 'sessionPins')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(sessionPinsDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'session-pins.domainClose')
    this.global = domain.global
    this.ctx.effect(() => this.ctx.sessionFlags.registerProvider({
      id: 'session-pins',
      list: () => {
        const flags: Record<SessionId, { pinned: true }> = {}
        for (const id of this.requireState().pinnedSessionIds) flags[id] = { pinned: true }
        return flags
      },
    }), 'session-pins.flagProvider')
  }

  private requireState(): SessionPinsDomainState {
    const state = this.global?.get()
    if (state === undefined) throw new Error('session-pins domain is not open')
    return state
  }

  private async commit(state: SessionPinsDomainState): Promise<SessionPinsSnapshot> {
    await this.global!.set(state)
    return snapshotOf(state)
  }

  @Remote('list')
  list(): SessionPinsSnapshot {
    return snapshotOf(this.requireState())
  }

  @Remote('setPinned')
  async setPinned(input: { sessionId: string; pinned: boolean }): Promise<SessionPinsSnapshot> {
    const sessionId = SessionId(input.sessionId)
    const current = this.requireState()
    const pinnedSessionIds = new Set(current.pinnedSessionIds)
    const groupOrder = cloneOrder(current.groupOrder)
    const flatOrder = [...current.flatOrder]
    if (input.pinned) {
      pinnedSessionIds.add(sessionId)
    } else {
      pinnedSessionIds.delete(sessionId)
      for (const key of Object.keys(groupOrder)) {
        const ids = groupOrder[key]!.filter(id => id !== sessionId)
        if (ids.length === 0) delete groupOrder[key]
        else groupOrder[key] = ids
      }
      flatOrder.splice(0, flatOrder.length, ...flatOrder.filter(id => id !== sessionId))
    }
    return this.commit({ ...current, pinnedSessionIds: [...pinnedSessionIds], groupOrder, flatOrder })
  }

  @Remote('reorderGroup')
  async reorderGroup(input: { groupKey: string; orderedIds: string[] }): Promise<SessionPinsSnapshot> {
    const ordered = input.orderedIds.map(SessionId)
    const current = this.requireState()
    const pinned = new Set(current.pinnedSessionIds)
    if (ordered.some(id => !pinned.has(id)) || new Set(ordered).size !== ordered.length) {
      throw new SessionPinsInvalidError(ordered)
    }
    return this.commit({ ...current, groupOrder: { ...cloneOrder(current.groupOrder), [input.groupKey]: ordered } })
  }

  @Remote('reorderFlat')
  async reorderFlat(input: { orderedIds: string[] }): Promise<SessionPinsSnapshot> {
    const ordered = input.orderedIds.map(SessionId)
    const current = this.requireState()
    const pinned = new Set(current.pinnedSessionIds)
    if (ordered.length !== pinned.size || ordered.some(id => !pinned.has(id))) {
      throw new SessionPinsInvalidError(ordered)
    }
    return this.commit({ ...current, flatOrder: ordered })
  }
}

export default SessionPinsService
```

- [ ] **Step 7: Write `src/invariant.ts`**

Copy `packages/host/plugin-inventory/src/invariant.ts`, package name `@deepseek-ai/dsh-session-pins`, companion name `session-pins-invariant`, and rationale:

```ts
/** Every mutation commits through the domain write chain before publishing its snapshot. */
const install: InvariantInstaller = () => {}
```

- [ ] **Step 8: Write the failing persistence test**

`packages/session/session-pins/tests/session-pins.spec.ts` uses the storage harness from `packages/workspace/workspace/tests/workspace.spec.ts` (memory backend) plus `Context.plugin(SessionFlagRegistry)` before `SessionPinsService`. Import `SessionPinsInvalidError` from `../src/index.ts`. The first test:

```ts
it('pins, persists, and unpins back to the original order', async () => {
  const h = await harness()
  expect(h.ctx.sessionPins.list()).toEqual({ pinnedSessionIds: [], groupOrder: {}, flatOrder: [] })
  const pinned = await h.ctx.sessionPins.setPinned({ sessionId: 's1', pinned: true })
  expect(pinned.pinnedSessionIds).toEqual([SessionId('s1')])
  const unpinned = await h.ctx.sessionPins.setPinned({ sessionId: 's1', pinned: false })
  expect(unpinned.pinnedSessionIds).toEqual([])
})

it('rejects reorder ids that are not currently pinned', async () => {
  const h = await harness()
  await expect(h.ctx.sessionPins.reorderGroup({ groupKey: '', orderedIds: ['ghost'] }))
    .rejects.toBeInstanceOf(SessionPinsInvalidError)
})
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm vitest run packages/session/session-pins/tests/session-pins.spec.ts`
Expected: PASS

- [ ] **Step 10: Run the persistence test again after restarting the service**

Add one assertion to the first test: dispose the `SessionPinsService` fiber, boot a fresh harness over the same `MemoryMediaPool`, and assert `list()` still returns the pinned id. Run the same command. Expected: PASS.

- [ ] **Step 11: Generate Typert artifacts**

Run: `pnpm run build:lib:host`
Expected: command completes; `packages/session/session-pins/lib/typert.host.js`, `lib/typert.remote-client.js`, and their declarations exist.

- [ ] **Step 12: Write bilingual READMEs and record the pair**

README sections: service API, domain shape, Remote methods table, error `session-pins-invalid`, Model Experience (zero direct tokens, no model-facing surface), and:

```markdown
## Known Limitations and Deferred Work

- **Cross-process live sync is deferred** — clients converge through `list()` after reconnect or restart.
- **Stale order keys are cleaned lazily** — deleted workspaces leave entries until the next mutation.
```

Translate to `README.zh.md`; run `pnpm run verify-translation-pairing --write packages/session/session-pins/README`.

- [ ] **Step 13: Commit**

```bash
git add packages/session/session-pins tsconfig.host.json pnpm-lock.yaml
git commit -m "feat(session-pins): add pinned-sessions domain and remote API"
```

---

### Task 3: Ship `sessionFlags` through `workspace.list`

**Files:**
- Modify: `packages/host/apiproxy/src/api/workspace.ts`
- Modify: `packages/host/apiproxy/src/api/workspace.schema.ts`
- Modify: `packages/host/apiproxy/src/api-proxy.ts`
- Modify: `packages/client/runtime/src/client/workspaces/manager.ts`
- Modify: `packages/client/runtime/src/client/workspaces/service.ts`
- Modify: `packages/client/runtime/src/client/contract/workspaces.ts`
- Modify: `packages/client/runtime/tests/fake-api.client.ts`
- Modify: `packages/client/runtime/tests/workspaces-service.client.spec.ts`
- Test: `packages/host/apiproxy/tests/api-proxy-workspace.spec.ts`

**Interfaces:**
- Consumes: `ctx.sessionFlags` on the host; `SessionFlags` from `@deepseek-ai/dsh-session-flags`.
- Produces: `workspace.list` value field `sessionFlags`; client `WorkspaceListState.sessionFlags`.

- [ ] **Step 1: Extend `workspace.ts` list response type**

In `WorkspaceApi.list`'s response type, change:

```ts
list(request: RpcRequest<{}>): Promise<RpcResponse<{
  items: WorkspaceView[]
  archivedSessionIds: SessionId[]
  sessionFlags: Record<SessionId, SessionFlags>
}>>
```

Add the import: `import type { SessionFlags } from '@deepseek-ai/dsh-session-flags'`.

- [ ] **Step 2: Extend the zod schema**

In `packages/host/apiproxy/src/api/workspace.schema.ts`, add:

```ts
import type { SessionFlags } from '@deepseek-ai/dsh-session-flags'

const sessionFlagsSchema = z.object({
  pinned: z.boolean().optional(),
}) satisfies z.ZodType<Wire<SessionFlags>>

export const sessionFlagsRecordSchema = z.record(sessionIdSchema, sessionFlagsSchema)
```

Change `workspaceListValueSchema` to include `sessionFlags: sessionFlagsRecordSchema`.

- [ ] **Step 3: Add the sessionFlags service to the gateway**

In `packages/host/apiproxy/src/api-proxy.ts`:
- Add the `sessionFlags` field to `ApiProxyService.static inject`.
- In `createApiProxy`, change the `workspace.list` implementation near line 2824 to:

```ts
list: async (request) => ok(request, {
  items: ctx.workspaceRegistry.list().map(workspaceView),
  archivedSessionIds: [...ctx.workspaceRegistry.archivedSessionIds],
  sessionFlags: ctx.sessionFlags.snapshot().flags,
}),
```

- [ ] **Step 4: Extend the client manager state**

In `WorkspaceManager`, add:

```ts
private sessionFlags: Readonly<Record<SessionId, SessionFlags>> = {}
```

In `refresh()`, after installing archived ids, add:

```ts
if (!this.archivedSupersedesRefresh) this.installSessionFlags(result.value.sessionFlags)
```

Add `installSessionFlags` beside `installArchived`, comparing entry counts per id and replacing only on change. Add `sessionFlags` to `WorkspaceListSnapshot` and `buildSnapshot()`.

- [ ] **Step 5: Extend the public client contracts**

Add `{ "path": "../../session/session-flags" }` to `packages/client/runtime/tsconfig.json` references.

In `packages/client/runtime/src/client/workspaces/service.ts` `WorkspaceListState`, add:

```ts
/** Generic session flags merged from host providers; `pinned: true` hides the row from grouping surfaces. */
sessionFlags: Readonly<Record<SessionId, SessionFlags>>
```

Import `SessionFlags` from `@deepseek-ai/dsh-session-flags` and `SessionId` from `@deepseek-ai/dsh-api-remotes/client`.

Update `WorkspaceRuntime.list` initial value with `sessionFlags: {}` and the projection assignment. Mirror the field in `packages/client/runtime/src/client/contract/workspaces.ts` only if that interface carries the list state.

- [ ] **Step 6: Update fake APIs**

In `packages/client/runtime/tests/fake-api.client.ts`, the `workspace.list` fixture result must include `sessionFlags: {}`; update every test expectation in `workspaces-service.client.spec.ts` that constructs `WorkspaceListState`.

- [ ] **Step 7: Add the host API proxy test**

In `packages/host/apiproxy/tests/api-proxy-workspace.spec.ts`, add one test that registers `SessionFlagRegistry` plus a provider returning `{ pinned: true }` for one id and asserts `workspace.list` carries that flag. Run the test and fix until green:

```bash
pnpm vitest run packages/host/apiproxy/tests/api-proxy-workspace.spec.ts
```

- [ ] **Step 8: Run client runtime workspace tests**

Run: `pnpm vitest run packages/client/runtime/tests/workspaces-service.client.spec.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/host/apiproxy packages/client/runtime packages/client/connection/tests/fake-api.client.ts
git commit -m "feat(workspaces): carry sessionFlags through workspace.list"
```

---

### Task 4: ui-workspace slots, filtering, search priority, and empty groups

**Files:**
- Modify: `packages/client/ui-workspace/src/client/contract/slots.ts`
- Modify: `packages/client/ui-workspace/src/client/index.ts`
- Modify: `packages/client/ui-workspace/src/client/tree.ts`
- Modify: `packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx`
- Modify: `packages/client/ui-workspace/src/client/rows/Rows.tsx`
- Modify: `packages/client/ui-workspace/src/client/locales.ts`
- Modify: `packages/client/ui-workspace/tests/tree.client.spec.ts`
- Modify: `packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx`
- Modify: `packages/client/ui-workspace/tests/rows.client.spec.tsx`
- Modify: `packages/client/ui-workspace/tests/apply.client.spec.ts`

**Interfaces:**
- Consumes: `useWorkspaces(state => state.sessionFlags)`.
- Produces: slots `sidebar.workspaces.pinned`, `sidebar.workspaces.sessionActions`, `sidebar.workspaces.searchResultExtra`; `deriveGroups`/`deriveFlat`/`deriveSearchResults` accept `sessionFlags`.

- [ ] **Step 1: Declare the three slots**

In `slots.ts`, add:

```ts
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar.workspaces.pinned': { kind: 'single'; scope: 'root'; owner: PinnedSectionOwnerProps }
    'sidebar.workspaces.sessionActions': { kind: 'list'; scope: 'root'; owner: SessionRowActionOwnerProps }
    'sidebar.workspaces.searchResultExtra': { kind: 'list'; scope: 'root'; owner: SearchResultExtraOwnerProps }
  }
}

export interface PinnedSectionOwnerProps { wide: boolean; view: 'grouped' | 'flat' }
export interface SessionRowActionOwnerProps { sessionId: SessionId; flat: boolean; blank: boolean }
export interface SearchResultExtraOwnerProps { sessionId: SessionId }
```

- [ ] **Step 2: Declare the child slots in the registration**

In `src/client/index.ts`, change the `sidebar.workspaces` registration's `children` to:

```ts
children: {
  'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' },
  'sidebar.workspaces.pinned': { kind: 'single', scope: 'root' },
  'sidebar.workspaces.sessionActions': { kind: 'list', scope: 'root' },
  'sidebar.workspaces.searchResultExtra': { kind: 'list', scope: 'root' },
},
```

- [ ] **Step 3: Thread `sessionFlags` through the tree derivations**

In `tree.ts`, import `SessionFlags` and change the three public signatures to accept `sessionFlags: Readonly<Record<SessionId, SessionFlags>>`. In each function compute:

```ts
const pinned = new Set(
  Object.entries(sessionFlags)
    .filter(([, flags]) => flags.pinned === true)
    .map(([id]) => id as SessionId),
)
```

Change `groupByWorkspace` to accept `pinned: ReadonlySet<SessionId>` and split membership:

```ts
for (const id of workspace.sessionIds) {
  const summary = list.byId[id]
  if (summary === undefined) continue
  accounted.add(id)
  if (!sessionVisible(summary, list.current, archived)) continue
  if (pinned.has(id)) continue
  members.push(summary)
}
```

Return the pre-pin count from `groupByWorkspace` by changing `Group` to include `accountSize: number`; set it to the count of `sessionVisible` members before the `pinned` filter. In `deriveGroups`, copy it onto `GroupNode.accountSize` and keep `sessionCount` as `members.length`.

In `deriveFlat`, filter rows with `if (pinned.has(s.id)) continue` after the `sessionVisible` check. In `deriveSearchResults`, after the deduplicated `ordered` array is built and before `.slice(0, limit)`, add:

```ts
ordered.sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)))
```

- [ ] **Step 4: Filter and sort in the React tree**

In `WorkspaceBrowser.tsx`:
- Read `const sessionFlags = useWorkspaces(state => state.sessionFlags)`.
- Pass it to `deriveGroups`, `deriveFlat`, and `deriveSearchResults` call sites.
- In `SessionTree`/`FlatList`/`SearchResults` props, add `sessionFlags` and thread it into their derivations.
- In `SessionTree`, for each group render the empty state when `group.accountSize > 0 && group.sessions.length === 0`:

```tsx
<div className={css.emptyProject}>
  {t('sessions.emptyPinned')}
</div>
```

- [ ] **Step 5: Render the pinned section inside the shared scroll list**

Pass `renderPinned: (owner: PinnedSectionOwnerProps) => ReactNode` into both `SessionTree` and `FlatList`; do not render it from `listArea` or `SearchResults`.

In `SessionTree`, immediately inside the `.list` div before the `groups.length === 0` empty-state branch, render:

```tsx
{renderPinned({ wide: true, view: 'grouped' })}
```

In `FlatList`, immediately inside the `.list` div before the flat rows, render:

```tsx
{renderPinned({ wide: true, view: 'flat' })}
```

In `WorkspaceBrowser`, bind:

```ts
const renderPinned = (owner: PinnedSectionOwnerProps) =>
  normalizedQuery === '' ? renderSlot('sidebar.workspaces.pinned', owner) : null
```

and pass `renderPinned` to `SessionTree` and `FlatList` in the browse branch only. Search mode never receives it, so the pinned section is absent during search (Q4=C) and the pinned section scrolls together with the project list (single scroll container).

- [ ] **Step 6: Render the row action slot**

Pass a `renderSessionActions` callback into `SessionTree`, `FlatList`, and `SessionNodeItem`. In `SessionNodeItem`'s `rowActions` span, before the `Menu` anchor, render:

```tsx
{renderSessionActions({ sessionId: node.id, flat, blank: row.blank })}
```

In the tree owners, bind it from the outer `renderSlot`:

```ts
const renderSessionActions = (owner: SessionRowActionOwnerProps) =>
  renderSlot('sidebar.workspaces.sessionActions', owner)
```

- [ ] **Step 7: Render the search extra slot**

Pass `renderSearchResultExtra` into `SearchResults` and `SearchResultItem`. In `SearchResultItem`'s `searchResultMeta`, before the workspace label, render:

```tsx
{renderSearchResultExtra({ sessionId: result.id })}
```

- [ ] **Step 8: Add locale keys**

In `locales.ts` zh/en add `'sessions.emptyPinned': '暂无未置顶会话 · 悬停标题行点 ＋ 新建会话'` / `'sessions.emptyPinned': 'No unpinned sessions · hover the header and press + to start one'`.

- [ ] **Step 9: Update tests for filtering and empty groups**

Add `sessionFlags` fixtures to `tree.client.spec.ts` cases:
- all members pinned → group remains with `sessions: []`, `accountSize: 2`;
- pinned search result sorts before an unpinned result with the same recency.

Update snapshots and props in `workspace-browser.client.spec.tsx`, `rows.client.spec.tsx`, and `apply.client.spec.ts` (assert the new child slots are declared).

- [ ] **Step 10: Run ui-workspace tests**

Run: `pnpm vitest run packages/client/ui-workspace`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add packages/client/ui-workspace
git commit -m "feat(ui-workspace): add pinned section and row-action slots"
```

---

### Task 5: `@deepseek-ai/dsh-client-ui-pinned-sessions` client plugin

**Files:**
- Create: `packages/client/ui-pinned-sessions/package.json`
- Create: `packages/client/ui-pinned-sessions/tsconfig.json`
- Create: `packages/client/ui-pinned-sessions/src/index.ts`
- Create: `packages/client/ui-pinned-sessions/src/invariant.ts`
- Create: `packages/client/ui-pinned-sessions/src/client/index.ts`
- Create: `packages/client/ui-pinned-sessions/src/client/stores.ts`
- Create: `packages/client/ui-pinned-sessions/src/client/locales.ts`
- Create: `packages/client/ui-pinned-sessions/src/client/PinnedSection.tsx`
- Create: `packages/client/ui-pinned-sessions/src/client/SessionPinAction.tsx`
- Create: `packages/client/ui-pinned-sessions/src/client/SearchPinBadge.tsx`
- Create: `packages/client/ui-pinned-sessions/tests/apply.client.spec.tsx`
- Create: `packages/client/ui-pinned-sessions/tests/store.client.spec.ts`
- Create: `packages/client/ui-pinned-sessions/tests/pinned-section.client.spec.tsx`
- Create: `packages/client/ui-pinned-sessions/README.md`
- Create: `packages/client/ui-pinned-sessions/README.zh.md`
- Modify: `tsconfig.client.json`

**Interfaces:**
- Consumes: `ctx.slots`, `ctx.locale`, `ctx.remote.sessionPins`, `useSessions`, `useWorkspaces`.
- Produces: `createPinnedSessionsStore`, `PinnedSection`, `SessionPinAction`, `SearchPinBadge`, locale namespace `sessionPins`.

- [ ] **Step 1: Create package.json and tsconfig.json**

Use `packages/client/ui-settings-skills/package.json` as the template. Name `@deepseek-ai/dsh-client-ui-pinned-sessions`, description `Pinned-sessions sidebar section and row actions for the DeepSeek Harness`, repository directory `packages/client/ui-pinned-sessions`, `dsh.client.inject`:

```json
"dsh": {
  "client": {
    "inject": [
      "@deepseek-ai/dsh-client-runtime",
      "@deepseek-ai/dsh-api-remotes",
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-ui-workspace"
    ],
    "platform": "web"
  }
}
```

peer/dev dependencies mirror the template plus `@deepseek-ai/dsh-client-ui-workspace`. `tsconfig.json` extends `../../../tsconfig.base.client.json` and references `../runtime`, `../ui-slots`, `../ui-primitives`, `../ui-workspace`, `../locale`, `../../../vendor/cordis`, `../../runtime-diagnostics/invariants`. Add the package to `tsconfig.client.json` references.

- [ ] **Step 2: Write the node half**

`src/index.ts` is the empty function plugin (copy `packages/client/ui-workspace/src/index.ts`, adjusting the module comment and package name). `src/invariant.ts` copies the ui-workspace invariant with package name `@deepseek-ai/dsh-client-ui-pinned-sessions` and companion name `client-ui-pinned-sessions-invariant`.

- [ ] **Step 3: Write the client store as a defineStore handle**

`src/client/stores.ts`:

```ts
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'

export interface SessionPinsSnapshot {
  readonly pinnedSessionIds: readonly SessionId[]
  readonly groupOrder: Readonly<Record<string, readonly SessionId[]>>
  readonly flatOrder: readonly SessionId[]
}

export interface PinnedSessionsState {
  snapshot: SessionPinsSnapshot
  ready: boolean
  error: string | null
}

type PinnedSessionsActions = {
  commit: (draft: PinnedSessionsState, snapshot: SessionPinsSnapshot) => void
  optimistic: (draft: PinnedSessionsState, snapshot: SessionPinsSnapshot) => void
  rollback: (draft: PinnedSessionsState, snapshot: SessionPinsSnapshot) => void
  fail: (draft: PinnedSessionsState, error: string) => void
}

export function createPinnedSessionsStore(): EngineStoreHandle<PinnedSessionsState, PinnedSessionsActions> {
  return defineStore({
    init: (): PinnedSessionsState => ({
      snapshot: { pinnedSessionIds: [], groupOrder: {}, flatOrder: [] },
      ready: false,
      error: null,
    }),
    actions: {
      commit: (d, snapshot) => { d.snapshot = snapshot; d.ready = true; d.error = null },
      optimistic: (d, snapshot) => { d.snapshot = snapshot; d.ready = true; d.error = null },
      rollback: (d, snapshot) => { d.snapshot = snapshot; d.error = null },
      fail: (d, error) => { d.error = error },
    },
  })
}
```

- [ ] **Step 4: Write the client apply**

`src/client/index.ts` follows the ui-theme bound-actions pattern: the registration `inject` factory captures the baked actions and drives refresh plus mutations.

```ts
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { createPinnedSessionsStore, type PinnedSessionsState, type SessionPinsSnapshot } from './stores.ts'
import { PinnedSection } from './PinnedSection.tsx'
import { SessionPinAction } from './SessionPinAction.tsx'
import { SearchPinBadge } from './SearchPinBadge.tsx'
import { en, zh } from './locales.ts'

export const inject = ['slots', 'locale', 'sessions', 'remote.sessionPins']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-pinned-sessions: dictionaries')
  const store = createPinnedSessionsStore()
  const remote = ctx.remote.sessionPins
  let bound: BoundActions<typeof store> | undefined
  let refresh: Promise<void> | null = null

  const sync = (snapshot: SessionPinsSnapshot): void => {
    bound?.commit(snapshot)
  }
  const reload = (): Promise<void> => {
    refresh ??= remote.list().then((snapshot) => { sync(snapshot) })
      .catch((reason: unknown) => { bound?.fail(String(reason)) })
      .finally(() => { refresh = null })
    return refresh
  }
  ctx.on('connection/reset', () => { void reload() })

  const injected = (actions: BoundActions<typeof store>) => {
    bound = actions
    void reload()
    return {
      open: (sessionId: string) => { ctx.sessions.open(sessionId as SessionId) },
      setPinned: async (sessionId: string, pinned: boolean, previous: SessionPinsSnapshot) => {
        const next = await remote.setPinned({ sessionId, pinned })
        actions.optimistic(next)
      },
      reorderGroup: async (groupKey: string, orderedIds: readonly string[], previous: SessionPinsSnapshot) => {
        actions.optimistic({ ...previous, groupOrder: { ...previous.groupOrder, [groupKey]: orderedIds } })
        try {
          actions.commit(await remote.reorderGroup({ groupKey, orderedIds: [...orderedIds] }))
        } catch (reason) {
          actions.rollback(previous)
          throw reason
        }
      },
      reorderFlat: async (orderedIds: readonly string[], previous: SessionPinsSnapshot) => {
        actions.optimistic({ ...previous, flatOrder: orderedIds })
        try {
          actions.commit(await remote.reorderFlat({ orderedIds: [...orderedIds] }))
        } catch (reason) {
          actions.rollback(previous)
          throw reason
        }
      },
    }
  }

  ctx.slots.inject('sidebar.workspaces.pinned', () => ctx.slots.register({
    name: 'sidebar.workspaces.pinned', store, locale: NS, inject: injected,
  }, PinnedSection))
  ctx.slots.inject('sidebar.workspaces.sessionActions', () => ctx.slots.register({
    name: 'sidebar.workspaces.sessionActions', id: 'pin', order: -10, store, locale: NS, inject: injected,
  }, SessionPinAction))
  ctx.slots.inject('sidebar.workspaces.searchResultExtra', () => ctx.slots.register({
    name: 'sidebar.workspaces.searchResultExtra', id: 'pin', store, locale: NS, inject: injected,
  }, SearchPinBadge))
}
```

`SessionPinAction` calls `setPinned(sessionId, pinned, snapshot)` and on rejection calls no extra rollback (the Remote failure path in Task 5 store tests asserts the previous snapshot remains installed via `rollback` only for reorder failures; `setPinned` waits for the Remote result before committing, so a rejection leaves the store unchanged).

- [ ] **Step 5: Write SessionPinAction**

`src/client/SessionPinAction.tsx`:

```tsx
import clsx from 'clsx'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionPinActionOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionPinInjected } from './index.ts'
import css from './SessionPinAction.module.css'

export function SessionPinAction({
  sessionId, blank, useStore, actions, t,
}: SessionPinActionOwnerProps & PropsStore<ReturnType<typeof createPinnedSessionsStore>>
  & SessionPinInjected & PropsLocale<'sessionPins'>) {
  const ready = useStore(s => s.ready)
  const snapshot = useStore(s => s.snapshot)
  if (blank || !ready) return null
  const pinned = snapshot.pinnedSessionIds.includes(sessionId)
  return (
    <button
      type="button"
      className={clsx(css.pinButton, pinned && css.pinOn)}
      aria-label={pinned ? t('unpin') : t('pin')}
      onClick={(event) => {
        event.stopPropagation()
        void actions.setPinned(sessionId, !pinned, snapshot)
      }}
    >
      <svg className={css.pinIcon} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M16 3l5 5-3.5 3.5L19 16l-3 1-5-5-4.5 4.5L5 15l6-6-5-5 1-3 4.5 1.5L16 3z" />
      </svg>
    </button>
  )
}
```

`SessionPinAction.module.css` gives `.pinButton` the same 22px round transparent icon-button geometry as ui-workspace's `.iconButton`, `.pinOn` color `#7fb0ff`, and `.pinIcon` `width:13px;height:13px;fill:currentColor`.

- [ ] **Step 6: Write SearchPinBadge**

`src/client/SearchPinBadge.tsx` reads the same store, returns `null` for non-pinned or not-ready stores, and renders:

```tsx
<span className={css.searchPinBadge} aria-label={t('pinnedBadge')}>
  <svg className={css.pinIcon} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M16 3l5 5-3.5 3.5L19 16l-3 1-5-5-4.5 4.5L5 15l6-6-5-5 1-3 4.5 1.5L16 3z" />
  </svg>
</span>
```

with `.searchPinBadge` color `#7fb0ff`, no pointer events.

- [ ] **Step 7: Write PinnedSection**

`src/client/PinnedSection.tsx` implements the complete pinned list with the standard global hooks:

```tsx
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { PinnedSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { PinnedSectionInjected } from './index.ts'
import { createPinnedSessionsStore } from './stores.ts'
import css from './PinnedSection.module.css'

export function PinnedSection({
  wide, view, useSessions, useWorkspaces, useStore, actions, open, t,
}: PropsRuntime<'sidebar.workspaces.pinned'>
  & PropsStore<ReturnType<typeof createPinnedSessionsStore>>
  & PinnedSectionInjected
  & PropsLocale<'sessionPins'>) {
  const sessions = useSessions(s => s)
  const workspaces = useWorkspaces(s => s.items)
  const state = useStore(s => s.snapshot)
  if (!wide || !useStore(s => s.ready) || state.pinnedSessionIds.length === 0) return null
  const byId = new Map(sessions.ids.map(id => [id, sessions.byId[id]]))
  const rows = view === 'flat'
    ? orderedFlatRows(state, sessions, byId)
    : orderedGroupedRows(state, workspaces, sessions, byId)
  return (
    <div className={css.pinnedRoot}>
      <div className={css.pinnedHeader} role="heading" aria-level={2}>
        <span>{t('pinned')}</span>
        <span className={css.count}>{state.pinnedSessionIds.length}</span>
      </div>
      <div role="tree" aria-label={t('pinned')}>
        {rows.map(row => (
          <div key={row.id} className={css.sessionRow} onClick={() => { open(row.id) }}>
            <span className={css.title}>{row.title}</span>
            <button type="button" className={css.unpin} aria-label={t('unpin')}
              onClick={(event) => { event.stopPropagation(); void actions.setPinned(row.id, false, state) }}>
              ×
            </button>
          </div>
        ))}
      </div>
      <div className={css.divider}><span>{t('projects')}</span></div>
    </div>
  )
}
```

`orderedGroupedRows` groups pinned ids by their workspace (`workspaces.find(w => w.sessionIds.includes(id))`, fallback group key `''` and label `t('ungrouped')`), orders each group by `state.groupOrder[key]` with fallback to the workspace `sessionIds` order, and emits one group header plus rows. `orderedFlatRows` orders by `state.flatOrder` with fallback to the session list `ids` recency order. `PinnedSection.module.css` copies the 32px row, 34px group header, and hover swap (time → pin/⋯) geometry from `packages/client/ui-workspace/src/client/rows/Rows.module.css`.

Drag wiring: rows are `draggable` in both views. Grouped drop only accepts rows whose group key matches and calls `actions.reorderGroup(groupKey, orderedIds, state)`; flat drop calls `actions.reorderFlat(orderedIds, state)`. After drop, render the optimistic store value; on rejection, the injected action already rolled back.

Opening a row calls `ctx.sessions.open(row.id)` through a `sessionPins.open` callback returned by `injected()`; add that callback beside `setPinned` in Step 4.

- [ ] **Step 8: Write the failing store and apply tests**

`store.client.spec.ts` proves `commit` installs a snapshot and `rollback` restores the previous one. `apply.client.spec.tsx` uses `dsh-client-test-runtime`, stubs `ctx.remote.sessionPins` with `list: async () => snapshot`, renders the sidebar-workspaces slots, and asserts three registrations exist and unregister on fiber dispose. `pinned-section.client.spec.tsx` renders empty, grouped, and flat states and asserts empty returns no DOM node.

- [ ] **Step 9: Run tests to verify they pass**

Run: `pnpm vitest run packages/client/ui-pinned-sessions/tests`
Expected: PASS

- [ ] **Step 10: Write bilingual READMEs and record the pair**

README sections: slot registrations, store contract, Remote methods used, locale namespace, Model Experience block (the sidebar catalog is UI-only; zero model tokens), and:

```markdown
## Known Limitations and Deferred Work

- **Pinned rows render the unpin action but no rename/fork/archive menu** — the owner's ellipsis menu is not reused inside the pinned section in v1.
```

Translate and run `pnpm run verify-translation-pairing --write packages/client/ui-pinned-sessions/README`.

- [ ] **Step 11: Commit**

```bash
git add packages/client/ui-pinned-sessions tsconfig.client.json pnpm-lock.yaml
git commit -m "feat(ui-pinned-sessions): add pinned section and row actions plugin"
```

---

### Task 6: Assemble both plugins into the web app bundle

**Files:**
- Modify: `packages/bundle/web-app/package.json`
- Modify: `packages/bundle/web-app/cordis.patch.yml`
- Modify: `packages/bundle/web-app/tests/assembled-boot.ts` (if it snapshots the roster)

**Interfaces:**
- Consumes: Task 1–5 package entrypoints.
- Produces: shipped web composition with `session-pins` host row and `ui-pinned-sessions` client row.

- [ ] **Step 1: Add dependencies**

In `packages/bundle/web-app/package.json` `dependencies`, add:

```json
"@deepseek-ai/dsh-session-pins": "workspace:^",
"@deepseek-ai/dsh-client-ui-pinned-sessions": "workspace:^"
```

- [ ] **Step 2: Add host row**

In `cordis.patch.yml`, after the `workspace` row:

```yaml
    - id: session-pins
      name: '@deepseek-ai/dsh-session-pins'
```

- [ ] **Step 3: Add client row**

In the browser plugin roster, immediately after `ui-workspace`:

```yaml
    - id: ui-pinned-sessions
      name: '@deepseek-ai/dsh-client-ui-pinned-sessions'
```

- [ ] **Step 4: Run the assembled-boot test and web build**

Run: `pnpm vitest run packages/bundle/web-app/tests/assembled-boot.ts`
Expected: PASS, with the two rows present in the roster.
Run: `pnpm run build`
Expected: command completes; generated `lib/typert.remote-client.js` artifacts are consumed by the client bundle.

- [ ] **Step 5: Real-composition web test**

Add one test to `packages/bundle/web-app/tests/` (or extend `assembled-boot.ts`) that boots the shipped web composition through the Loader, mounts the workspace browser with a stubbed `remote.sessionPins`, pins one session, and asserts the sidebar renders the pinned section while the project row moves out. Use the existing `dsh-client-test-runtime` fake APIs. Run only that file.

- [ ] **Step 6: Commit**

```bash
git add packages/bundle/web-app
git commit -m "feat(web-app): assemble pinned-sessions plugins"
```

---

### Task 7: Agent Note, pairing exclusions, and final gates

**Files:**
- Create: `.agents/notes/implemented/feature/2026-08-16-pinned-sessions.md`
- Create: `.agents/notes/implemented/feature/2026-08-16-pinned-sessions.zh.md`
- Create: `.agents/notes/implemented/feature/2026-08-16-pinned-sessions.i18n.yaml` (via pairing write)
- Modify: `scripts/translation-pairing.manifest.json`

**Interfaces:**
- Consumes: the shipped implementation from Tasks 1–6.
- Produces: an implemented Agent Note recording the decision and the doc-sync exclusions for the single-file spec/plan.

- [ ] **Step 1: Write the implemented Agent Note pair**

`2026-08-16-pinned-sessions.md` records, in present tense: the shipped pin semantics (move out, grouped/flat follow, default order plus overrides, hover-only actions, search priority, empty states), the three-package split, the `workspace.list.sessionFlags` wire addition, the Remote methods, and the named coverage gap that cross-process live sync is deferred. Use the implemented-note skeleton from `.agents/notes/README.md` and include the required Alternatives-considered block (settings persistence and direct ui-workspace implementation were rejected for domain/plugin reasons).

Create the faithful `.zh.md` counterpart, then run:

```bash
pnpm run verify-translation-pairing --write .agents/notes/implemented/feature/2026-08-16-pinned-sessions
```

- [ ] **Step 2: Register single-file doc exclusions**

In `scripts/translation-pairing.manifest.json` `excluded`, add:

```json
"docs/superpowers/specs/2026-08-16-pinned-sessions-design.zh.md",
"docs/superpowers/plans/2026-08-16-pinned-sessions.md"
```

- [ ] **Step 3: Run documentation gates**

Run:

```bash
pnpm run verify-md-wrap
pnpm run verify-md-links
pnpm run verify-translation-pairing docs/superpowers/specs/2026-08-16-pinned-sessions-design.zh.md
pnpm run doc-sync
```

Expected: the scoped pairing check reports excluded; `doc-sync` passes for the changed docs or reports only pre-existing unrelated pair failures.

- [ ] **Step 4: Run implementation gates**

Run:

```bash
pnpm run lint
pnpm run typecheck
pnpm vitest run packages/session/session-flags packages/session/session-pins packages/host/apiproxy/tests/api-proxy-workspace.spec.ts packages/client/runtime packages/client/ui-workspace packages/client/ui-pinned-sessions packages/bundle/web-app/tests
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Record the product GIF**

Start the web server with `pnpm run dev:web` in the worktree, open the app, and record a GIF showing: hover a session row, pin it, the session moves into the pinned section grouped under its workspace, the project group remains with `＋`, pinning the last session leaves the empty project group, drag reorder inside the pinned section, switch to flat view, search and observe pinned-first with blue badge, unpin and observe the session return to its original project position, and reload to confirm persistence. Save the GIF under `docs/superpowers/assets/pinned-sessions.gif` and reference it from the spec.

- [ ] **Step 6: Commit**

```bash
git add .agents/notes/implemented/feature/2026-08-16-pinned-sessions* scripts/translation-pairing.manifest.json docs/superpowers
git commit -m "docs(session-pins): record implemented note and product demo"
```

---

### Task 8: Pre-push verification

**Files:** none (verification only)

- [ ] **Step 1: Run the minimal covering checks**

The `dsh-pre-push-checks` skill is agent guidance, not a root script; run the smallest covering checks explicitly:

```bash
pnpm run typecheck
pnpm run lint
pnpm vitest run packages/session/session-flags packages/session/session-pins packages/host/apiproxy/tests/api-proxy-workspace.spec.ts packages/client/runtime packages/client/ui-workspace packages/client/ui-pinned-sessions packages/bundle/web-app/tests
pnpm run doc-sync
git diff --check
```

Expected: all pass.

- [ ] **Step 2: Report readiness**

Report the worktree path, branch, test summary, GIF path, and offer to push or open a PR.
