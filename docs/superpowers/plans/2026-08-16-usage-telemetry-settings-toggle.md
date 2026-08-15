# Usage Telemetry Web Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing `usage-telemetry` settings namespace to the Web client and add a Plugins settings card that toggles local usage recording.

**Architecture:** The Host already registers and hot-applies the namespace; this plan only adds the api-proxy allowlist entry and a new `settings.plugin.item` card in `dsh-client-ui-settings-plugins` that stages one boolean switch and writes the `enabled` leaf through `SettingsScope`.

**Tech Stack:** TypeScript, Cordis, Schemastery, React 18, CSS Modules, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-16-dsh-usage-telemetry-push-design.md` (Part A).

## Global Constraints

- Worktree: `/home/huawei/dsh-usage-telemetry-push`, branch `feat/dsh-usage-telemetry-push`.
- Namespace literal: `usage-telemetry` (import `USAGE_TELEMETRY_SETTINGS_NAMESPACE` on the Host, spell the literal in client code — client packages must not import Host packages).
- Only the `enabled` leaf is written; never restate the section.
- Copy is bilingual; Chinese and English key sets are identical.
- Every package change keeps package invariants, translation pairing, client catalog, and cordis catalog checks green.
- Run tests from the worktree root.

---

### Task 1: Expose `usage-telemetry` through api-proxy

**Files:**
- Modify: `packages/host/apiproxy/src/api-proxy.ts`
- Modify: `packages/host/apiproxy/package.json`
- Modify: `packages/host/apiproxy/tsconfig.json`
- Test: `packages/host/apiproxy/tests/api-proxy-config.spec.ts`

**Interfaces:**
- Consumes: `USAGE_TELEMETRY_SETTINGS_NAMESPACE` exported from `@deepseek-ai/dsh-usage-telemetry` (`packages/telemetry/usage-telemetry/src/index.ts`).
- Produces: `settings.describe` returns a view whose `ns` is `usage-telemetry`; `settings.update` accepts it.

- [ ] **Step 1: Write the failing test**

Append this test to `api-proxy-config.spec.ts` after the mcp-servers exposure test. Add the import at the top:

```ts
import { USAGE_TELEMETRY_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-usage-telemetry'
```

```ts
it('exposes the usage-telemetry namespace to the Web client', async () => {
  const ctx = await harness()
  ctx.settings.register(USAGE_TELEMETRY_SETTINGS_NAMESPACE, z.object({
    enabled: z.boolean().default(true),
  }))
  const api = createApiProxy(ctx, DEFAULTS)

  const described = expectOk(await api.settings.describe(request({})))
  expect(described.namespaces.some(view => view.ns === 'usage-telemetry')).toBe(true)
  const mutated = expectOk(await api.settings.update(request({
    ns: 'usage-telemetry',
    patch: { enabled: false },
  })))
  expect(mutated.value).toEqual({ enabled: false })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/host/apiproxy/tests/api-proxy-config.spec.ts -t "usage-telemetry"`

Expected: FAIL — `settings-not-exposed` (or import resolution failure if the dependency is absent; both prove the gap).

- [ ] **Step 3: Add the import and allowlist entry**

In `packages/host/apiproxy/src/api-proxy.ts`, add the import next to `SKILL_SETTINGS_NAMESPACE`:

```ts
import { USAGE_TELEMETRY_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-usage-telemetry'
```

Add the namespace to `WEB_SETTINGS_NAMESPACES`:

```ts
const WEB_SETTINGS_NAMESPACES = [
  'agent-loop', 'shell', 'locale', 'mcp-servers', 'permission', 'ui-conversation', 'ui-theme', 'web-search-deepseek',
  SKILL_SETTINGS_NAMESPACE,
  USAGE_TELEMETRY_SETTINGS_NAMESPACE,
] as const
```

- [ ] **Step 4: Add package and type references**

In `packages/host/apiproxy/package.json` `dependencies`, add:

```json
"@deepseek-ai/dsh-usage-telemetry": "workspace:^",
```

In `packages/host/apiproxy/tsconfig.json` `references`, add:

```json
{
  "path": "../../telemetry/usage-telemetry"
},
```

- [ ] **Step 5: Install and run the test**

Run:

```bash
pnpm install --frozen-lockfile
pnpm vitest run packages/host/apiproxy/tests/api-proxy-config.spec.ts -t "usage-telemetry"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/host/apiproxy/src/api-proxy.ts packages/host/apiproxy/package.json packages/host/apiproxy/tsconfig.json packages/host/apiproxy/tests/api-proxy-config.spec.ts pnpm-lock.yaml
git commit -m "feat(apiproxy): expose usage-telemetry settings to the Web client"
```

---

### Task 2: Add the Usage Telemetry card controller

**Files:**
- Create: `packages/client/ui-settings-plugins/src/client/usage-telemetry-card-controller.ts`
- Test: `packages/client/ui-settings-plugins/tests/usage-telemetry-card.client.spec.ts`

**Interfaces:**
- Consumes: `SettingsScope` / `SnapshotStore` / `createSnapshotStore` from `@deepseek-ai/dsh-client-runtime/client`; `CardActions` and `CardShell` from `./card-form.ts`.
- Produces:
  - `USAGE_TELEMETRY_NS = 'usage-telemetry'`
  - `UsageTelemetrySettings = { enabled?: boolean }`
  - `UsageTelemetryCardState extends CardShell { enabled: boolean; draft: boolean }`
  - `UsageTelemetryCardFace extends CardActions { hooks: { usageTelemetryCard: SnapshotStore<UsageTelemetryCardState> } }`
  - `class UsageTelemetryCardController { constructor(scope: SettingsScope<UsageTelemetrySettings>); inject(): UsageTelemetryCardFace }`

- [ ] **Step 1: Write the failing controller test**

Create `packages/client/ui-settings-plugins/tests/usage-telemetry-card.client.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  USAGE_TELEMETRY_NS, UsageTelemetryCardController,
} from '../src/client/usage-telemetry-card-controller.ts'

describe('UsageTelemetryCardController', () => {
  function subject(initial: { value?: { enabled?: boolean }; user?: { enabled?: boolean }; writable?: boolean } = {}) {
    const host = stubSettingsScope<{ enabled?: boolean }>()
    host.publish({
      status: 'ready',
      writable: initial.writable ?? true,
      value: initial.value ?? { enabled: true },
      base: { enabled: true },
      user: initial.user ?? {},
      revision: 1,
    })
    host.set.mockImplementation(async (field: string, value: unknown) => {
      host.publish({ ...host.scope.getSnapshot(), value: { enabled: value as boolean }, user: { enabled: value as boolean } })
    })
    const controller = new UsageTelemetryCardController(host.scope)
    return { host, face: controller.inject(), store: controller.store }
  }

  it('shows the effective value and stays clean until edited', () => {
    const { store } = subject()
    expect(store.getSnapshot()).toMatchObject({ available: true, writable: true, enabled: true, draft: true, dirty: false })
  })

  it('stages the opposite value and writes only the enabled leaf on save', async () => {
    const { host, face, store } = subject()
    face.edit('enabled', 'false')
    expect(store.getSnapshot()).toMatchObject({ draft: false, dirty: true })

    await face.save()

    expect(host.set).toHaveBeenCalledWith('enabled', false)
    expect(store.getSnapshot()).toMatchObject({ enabled: false, draft: false, dirty: false, failed: false })
  })

  it('keeps a rejected save dirty and failed', async () => {
    const host = stubSettingsScope<{ enabled?: boolean }>()
    host.publish({ status: 'ready', writable: true, value: { enabled: true }, base: { enabled: true }, user: {}, revision: 1 })
    host.set.mockImplementation(async () => {
      host.publish({ ...host.scope.getSnapshot(), value: { enabled: true }, user: {} })
    })
    const controller = new UsageTelemetryCardController(host.scope)
    const face = controller.inject()
    face.edit('enabled', 'false')
    await face.save()
    expect(controller.store.getSnapshot()).toMatchObject({ draft: false, dirty: true, failed: true, enabled: true })
  })

  it('discard drops the staged edit', () => {
    const { face, store } = subject()
    face.edit('enabled', 'false')
    face.discard()
    expect(store.getSnapshot()).toMatchObject({ draft: true, dirty: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/client/ui-settings-plugins/tests/usage-telemetry-card.client.spec.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the controller**

Create `packages/client/ui-settings-plugins/src/client/usage-telemetry-card-controller.ts`:

```ts
/**
 * The usage-telemetry card's staged switch over the `usage-telemetry` settings
 * namespace. Only the `enabled` leaf is written; the capture service applies
 * committed changes without a restart.
 */

import {
  createSnapshotStore, type SettingsScope, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { CardActions, CardShell } from './card-form.ts'

/** Namespace of the local usage recorder. Spelled here: a client package must not depend on a Host package. */
export const USAGE_TELEMETRY_NS = 'usage-telemetry'

/** The section fields this card edits. */
export interface UsageTelemetrySettings {
  /** Whether local usage capture listens to `llm/stream`. */
  enabled?: boolean
}

/** What the usage-telemetry card renders. */
export interface UsageTelemetryCardState extends CardShell {
  /** Effective enablement served by the Host. */
  enabled: boolean
  /** The staged switch value; equals `enabled` while the card is clean. */
  draft: boolean
}

/** The registration-side face the usage-telemetry card's slot entry injects. */
export interface UsageTelemetryCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useUsageTelemetryCard. */
    usageTelemetryCard: SnapshotStore<UsageTelemetryCardState>
  }
}

/** Bridges the `usage-telemetry` scope onto the card's single switch. */
export class UsageTelemetryCardController {
  /** uSES-safe state source shared by the registered card. */
  readonly store: SnapshotStore<UsageTelemetryCardState>

  private draft: boolean | undefined
  private saving = false
  private failed = false

  /**
   * @param scope - the bound settings scope for the `usage-telemetry` namespace.
   */
  constructor(private readonly scope: SettingsScope<UsageTelemetrySettings>) {
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => { this.store.set(this.projection()) })
    this.store.set(this.projection())
  }

  /** Effective value when no draft is staged. */
  private effective(): boolean {
    return this.scope.getSnapshot().value?.enabled ?? true
  }

  private projection(): UsageTelemetryCardState {
    const snapshot = this.scope.getSnapshot()
    const draft = this.draft ?? this.effective()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.draft !== undefined,
      invalid: false,
      saving: this.saving,
      failed: this.failed,
      enabled: this.effective(),
      draft,
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its staged edit actions.
   */
  inject(): UsageTelemetryCardFace {
    return {
      hooks: { usageTelemetryCard: this.store },
      edit: (field, text) => {
        if (field !== 'enabled') throw new Error(`usage telemetry card has no field ${field}`)
        this.draft = text === 'true'
        this.failed = false
        this.store.set(this.projection())
      },
      resetField: (field) => {
        if (field !== 'enabled') throw new Error(`usage telemetry card has no field ${field}`)
        this.draft = this.scope.getSnapshot().base?.enabled ?? true
        this.failed = false
        this.store.set(this.projection())
      },
      save: () => { void this.save() },
      discard: () => {
        this.draft = undefined
        this.failed = false
        this.store.set(this.projection())
      },
    }
  }

  /**
   * Write the staged switch, then re-read whether the Host accepted it.
   * The Host is the authority: a read-only document or a settings conflict
   * leaves the draft in place for the user to retry or discard.
   */
  private async save(): Promise<void> {
    const draft = this.draft
    if (draft === undefined || this.saving) return
    this.saving = true
    this.failed = false
    this.store.set(this.projection())
    let accepted = false
    try {
      await this.scope.set('enabled', draft)
      accepted = this.scope.getSnapshot().value?.enabled === draft
    } catch {
      accepted = false
    }
    if (accepted) this.draft = undefined
    this.saving = false
    this.failed = !accepted
    this.store.set(this.projection())
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/client/ui-settings-plugins/tests/usage-telemetry-card.client.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/ui-settings-plugins/src/client/usage-telemetry-card-controller.ts packages/client/ui-settings-plugins/tests/usage-telemetry-card.client.spec.ts
git commit -m "feat(ui-settings-plugins): stage usage telemetry enabled switch"
```

---

### Task 3: Render and register the Usage Telemetry card

**Files:**
- Create: `packages/client/ui-settings-plugins/src/client/UsageTelemetryCard.tsx`
- Modify: `packages/client/ui-settings-plugins/src/client/index.ts`
- Modify: `packages/client/ui-settings-plugins/src/client/locales.ts`
- Modify: `packages/client/ui-settings-plugins/tests/apply.client.spec.ts`
- Test: `packages/client/ui-settings-plugins/tests/usage-telemetry-card.client.spec.tsx` (component smoke)

**Interfaces:**
- Consumes: `UsageTelemetryCardController`, `UsageTelemetryCardFace` from the previous task; `PluginCard` and `PluginsSettingsLocaleKey` in the same package.
- Produces: slot entry `settings.plugin.item` id `usage-telemetry`, order 30, component `UsageTelemetryCard`.

- [ ] **Step 1: Write failing registration and component tests**

Update `apply.client.spec.ts` expectations in two places:

```ts
expect(slots.entries('settings.plugin.item').map(entry => entry.options.id))
  .toEqual(['bash', 'agent-loop', 'web-search', 'usage-telemetry'])
```

```ts
expect((tab.inject as unknown as () => ConfigurablePluginsTabInjected)()).toEqual({ cardCount: 4 })
```

Create `usage-telemetry-card.client.spec.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { en } from '../src/client/locales.ts'
import { UsageTelemetryCard } from '../src/client/UsageTelemetryCard.tsx'
import type { UsageTelemetryCardProps } from '../src/client/UsageTelemetryCard.tsx'
import type { UsageTelemetryCardState } from '../src/client/usage-telemetry-card-controller.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

it('renders the card title and stages the opposite switch value', () => {
  const state = createSnapshotStore<UsageTelemetryCardState>({
    available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
    enabled: true, draft: true,
  })
  const edit = vi.fn()
  const props = {
    ...{ edit, resetField: vi.fn(), save: vi.fn(), discard: vi.fn() },
    t,
    useUsageTelemetryCard: bindSnapshotSelector(state),
  } as unknown as UsageTelemetryCardProps
  render(<UsageTelemetryCard {...props} />)
  expect(screen.getByText(en.usageTelemetryTitle)).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox', { name: en.usageTelemetryEnabled }))
  expect(edit).toHaveBeenCalledWith('enabled', 'false')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/client/ui-settings-plugins/tests/apply.client.spec.ts packages/client/ui-settings-plugins/tests/usage-telemetry-card.client.spec.tsx`

Expected: FAIL — card id list has 3 entries; module not found.

- [ ] **Step 3: Add locale copy**

In `locales.ts`, extend the key union with:

```ts
| 'usageTelemetryTitle' | 'usageTelemetryDescription'
| 'usageTelemetryEnabled' | 'usageTelemetryEnabledHint'
```

Add English:

```ts
usageTelemetryTitle: 'Usage telemetry',
usageTelemetryDescription: 'Records each model call to the local usage file.',
usageTelemetryEnabled: 'Record usage locally',
usageTelemetryEnabledHint: 'DeepSeek Monitor and other external tools read the local telemetry file.',
```

Add Chinese:

```ts
usageTelemetryTitle: 'Usage 遥测',
usageTelemetryDescription: '把每次模型调用记录到本地 usage 文件。',
usageTelemetryEnabled: '本地记录 usage',
usageTelemetryEnabledHint: 'DeepSeek Monitor 等外部工具会读取本地遥测文件。',
```

- [ ] **Step 4: Create the card component**

Create `UsageTelemetryCard.tsx`:

```tsx
/**
 * The usage-telemetry plugin's card: one staged switch for local recording.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PluginCard } from './PluginCard.tsx'
import type { UsageTelemetryCardFace } from './usage-telemetry-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the usage-telemetry card. */
export type UsageTelemetryCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<UsageTelemetryCardFace>

/**
 * Render the usage-telemetry card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function UsageTelemetryCard(props: UsageTelemetryCardProps) {
  const { t } = props
  const state = props.useUsageTelemetryCard(snapshot => snapshot)
  return (
    <PluginCard
      t={t}
      titleKey="usageTelemetryTitle"
      descriptionKey="usageTelemetryDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <label>
        <input
          type="checkbox"
          checked={state.draft}
          disabled={!state.writable}
          onChange={(event) => { props.edit('enabled', String(event.currentTarget.checked)) }}
        />
        <span>{t('usageTelemetryEnabled')}</span>
      </label>
      <p>{t('usageTelemetryEnabledHint')}</p>
    </PluginCard>
  )
}
```

- [ ] **Step 5: Register the card**

In `packages/client/ui-settings-plugins/src/client/index.ts`, import:

```ts
import { UsageTelemetryCard } from './UsageTelemetryCard.tsx'
import { USAGE_TELEMETRY_NS, UsageTelemetryCardController } from './usage-telemetry-card-controller.ts'
export type { UsageTelemetryCardFace, UsageTelemetryCardState } from './usage-telemetry-card-controller.ts'
```

In `apply`, construct:

```ts
const usageTelemetry = new UsageTelemetryCardController(
  ctx.settingsScope.bind({ namespace: USAGE_TELEMETRY_NS }),
)
```

Add the yield block after web-search:

```ts
yield ctx.slots.register({
  name: 'settings.plugin.item',
  id: 'usage-telemetry',
  order: 30,
  locale: NS,
  inject: () => usageTelemetry.inject(),
}, UsageTelemetryCard)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run packages/client/ui-settings-plugins`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/client/ui-settings-plugins/src/client/UsageTelemetryCard.tsx packages/client/ui-settings-plugins/src/client/index.ts packages/client/ui-settings-plugins/src/client/locales.ts packages/client/ui-settings-plugins/tests/apply.client.spec.ts packages/client/ui-settings-plugins/tests/usage-telemetry-card.client.spec.tsx
git commit -m "feat(ui-settings-plugins): render and register usage telemetry card"
```

---

### Task 4: Update generated goldens and run the full gate

**Files:**
- Modify: `apps/web/tests/snapshots/plugin-config/section.expected.md` and any other Plugins settings golden that now shows the fourth card.
- Modify: generated catalogs if `pnpm run verify-client-catalog` or `pnpm run verify-cordis-catalog` reports a diff.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: green focused gates and a committed state.

- [ ] **Step 1: Refresh Web goldens**

Run:

```bash
DSH_SNAPSHOT=refresh pnpm vitest run apps/web/tests/plugin-config.e2e.ts --config vitest.web.config.ts
```

Review the diff so the only change is the new `Usage telemetry` card and its collapsed header.

- [ ] **Step 2: Regenerate catalogs if requested**

Run:

```bash
pnpm run verify-client-catalog
pnpm run verify-cordis-catalog
```

If either reports out of date, run the corresponding generator script (the error names it) and inspect the diff.

- [ ] **Step 3: Run focused type/lint/tests**

```bash
pnpm exec tsc -b tsconfig.client.json tsconfig.host.json
pnpm exec oxlint --config .oxlintrc.json packages/host/apiproxy packages/client/ui-settings-plugins
pnpm vitest run packages/host/apiproxy/tests/api-proxy-config.spec.ts packages/client/ui-settings-plugins
```

Expected: all pass.

- [ ] **Step 4: Verify docs and package invariants**

```bash
pnpm run verify-package-invariants
pnpm run verify-package-readme-model-experience
pnpm run verify-package-readme-limitations
pnpm run verify-translation-pairing
```

The global pairing command may report unrelated pre-existing pairs in other worktrees; ensure the files touched by this plan introduce no new violation.

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/snapshots/plugin-config/section.expected.md
git commit -m "test(web): pin usage telemetry plugin card golden"
```

---

## Self-review

- Spec coverage: Part A host allowlist (Task 1), card controller (Task 2), card render/registration/locale (Task 3), goldens/gates (Task 4).
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: `USAGE_TELEMETRY_NS`, `UsageTelemetryCardFace`, and `usageTelemetryCard` store name are identical across Tasks 2–3.
