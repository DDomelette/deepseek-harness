/**
 * Shared test fixtures: a minimal Loader face. The manager's `mcp-servers`
 * section is the plugin's own Config, so a test supplies it as the plugin
 * config and edits it through `fiber.update()` — no settings provider takes
 * part.
 */

import type { McpServersConfig, McpServersRoster } from '../src/schema.ts'

/**
 * Section for a mount-time plugin config. A composition — and a test standing
 * in for one — supplies the plain roster under `servers`; Schemastery resolves
 * that raw value into the live reference the constructor receives, so only the
 * call itself needs the resolved type. A later edit goes through
 * `fiber.update()`, which takes raw config as the Loader does.
 * @param roster - the roster the composition stores.
 * @returns the same roster as the mount-time config argument.
 */
export function mountSection(roster: McpServersRoster): McpServersConfig {
  return { servers: roster } as unknown as McpServersConfig
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
