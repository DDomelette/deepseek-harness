/**
 * Shared test fixtures: an in-memory settings provider and a minimal Loader
 * face. `@deepseek-ai/dsh-settings` keeps its own memory fixture unexported,
 * so this package carries a local mirror instead of widening that package's
 * exports.
 */

import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'

/** In-memory provider implementing only the three provider primitives. */
export class MemorySettings extends SettingsProvider {
  /** Raw document the provider "storage" currently holds. */
  doc: Record<string, unknown>

  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], options?: {
    doc?: Record<string, unknown>
  }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
  }

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

/** Declarative entry facts the fake Loader surface carries. */
export interface FakeLoaderEntry {
  name: string
  config?: unknown
  disabled?: boolean
  group?: boolean
  /** Root Fiber state value; absent means the entry has no live root Fiber. */
  fiberState?: number
}

/** Minimal Loader face: the plugin and its invariant only ever read entries(). */
export function fakeLoader(entries: FakeLoaderEntry[]) {
  return {
    entries: () => entries.map((entry, index) => ({
      id: `test/${index}`,
      options: {
        id: `test/${index}`,
        name: entry.name,
        config: entry.config,
        group: entry.group ?? false,
      },
      disabled: entry.disabled ?? false,
      fiber: entry.fiberState === undefined ? undefined : { state: entry.fiberState },
    })),
  }
}
