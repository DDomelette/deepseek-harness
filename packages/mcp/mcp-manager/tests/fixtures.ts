/**
 * Shared test fixtures: a minimal Loader face. The manager's `mcp-servers`
 * section is the plugin's own Config, so a test supplies it as the plugin
 * config and edits it through `fiber.update()` — no settings provider takes
 * part.
 */

import type { McpServersConfig, McpServersSection } from '../src/schema.ts'

/**
 * Section for a mount-time plugin config. A Config with a volatile root takes
 * its resolved reference type at the call site, while a composition — and a
 * test standing in for one — supplies the plain section; a later edit goes
 * through `fiber.update()`, which takes raw config as the Loader does.
 * @param section - the section the composition stores.
 * @returns the same section as the mount-time config argument.
 */
export function mountSection(section: McpServersSection): McpServersConfig {
  return section as unknown as McpServersConfig
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
