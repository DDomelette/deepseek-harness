/**
 * Acceptance-path coverage for the rescope codemod's exact-edit classifier: a
 * duplicated insertion — what a non-idempotent apply produces — must be
 * rejected rather than applied again.
 */

import { describe, expect, it } from 'vitest'
import { exactEditState, rewritePackageNames } from './rescope-vendor.ts'

const ANCHOR = '\n## Sync procedure'
const INSERTED = `\n15. **rescope**: one log entry.\n${ANCHOR}`

describe('package names and product identifiers', () => {
  it.each([
    ['packages/client/ui-agent-preset/src/client/CreatePluginMenuItem.tsx', "const preset = 'cordis'"],
    ['packages/extensions/ui-cordis/src/client/CordisPreparingRow.tsx', "type Locale = PropsLocale<'cordis'>"],
    ['snapshots/session/cordis-inspect-liveness/client-fixture.mjs', "ctx.on('cordis/inspect-query', listener)"],
  ])('preserves product data in %s while rewriting module references', (file, product) => {
    const source = `${product}; import { Context } from 'cordis'; import z from 'schemastery'\n`
    const expected = `${product}; import { Context } from '@deepseek-ai/cordis'; import z from '@deepseek-ai/schemastery'\n`
    expect(rewritePackageNames(source, file).text).toBe(expected)
    expect(rewritePackageNames(expected, file, true).text).toBe(source)
  })

  it('keeps a documented preset id and rewrites the package import beside it', () => {
    const source = "Use `cordis` for this preset.\n```ts\nimport { Context } from 'cordis'\n```\n"
    const expected = "Use `cordis` for this preset.\n```ts\nimport { Context } from '@deepseek-ai/cordis'\n```\n"
    expect(rewritePackageNames(source, 'docs/upgrade-guide/v0.2.0-rc.2/schedule-bundle-retired/guide.md').text).toBe(expected)
  })

  it.each([
    ["type T = import('cordis').Context", "type T = import('@deepseek-ai/cordis').Context"],
    ["declare module 'cordis' {}", "declare module '@deepseek-ai/cordis' {}"],
    ["require('cordis')", "require('@deepseek-ai/cordis')"],
    ["require.resolve('cordis')", "require.resolve('@deepseek-ai/cordis')"],
    ["import.meta.resolve('cordis')", "import.meta.resolve('@deepseek-ai/cordis')"],
    ["vi.mock('cordis')", "vi.mock('@deepseek-ai/cordis')"],
    ["import { Context } from\n'cordis'", "import { Context } from\n'@deepseek-ai/cordis'"],
  ])('rewrites the module selector %s in a file with product identifiers', (source, expected) => {
    const file = 'packages/client/ui-agent-preset/src/client/CreatePluginMenuItem.tsx'
    expect(rewritePackageNames(`${source}; const id = 'cordis'\n`, file).text)
      .toBe(`${expected}; const id = 'cordis'\n`)
  })

  it('rewrites unscoped framework imports in an unlisted source file', () => {
    const source = "import { Context } from 'cordis'; type ContextType = import('cordis').Context\n"
    expect(rewritePackageNames(source, 'packages/example/plugin/src/index.ts').text)
      .toBe("import { Context } from '@deepseek-ai/cordis'; type ContextType = import('@deepseek-ai/cordis').Context\n")
  })
})

describe('exactEditState', () => {
  it('classifies an insertion by its target form, so a duplicate is invalid', () => {
    expect(exactEditState(`log\n${ANCHOR}\n`, ANCHOR, INSERTED, 1)).toBe('pending')
    expect(exactEditState(`log${INSERTED}\n`, ANCHOR, INSERTED, 1)).toBe('applied')
    // The anchor survives an insertion, so counting the source form would have
    // called this pending and inserted the entry a second time.
    expect(exactEditState(`log${INSERTED}${INSERTED}\n`, ANCHOR, INSERTED, 1)).toBe('invalid')
    expect(exactEditState('log\n', ANCHOR, INSERTED, 1)).toBe('invalid')
  })

  it('classifies a deletion by its source form, and requires its remainder to survive', () => {
    const remainder = 'exclude:\n'
    const withEntries = 'exclude:\n  - cordis@4\n'
    expect(exactEditState(withEntries, withEntries, remainder, 1)).toBe('pending')
    expect(exactEditState(remainder, withEntries, remainder, 1)).toBe('applied')
    // Upstream dropped the whole field: the source form is gone, but so is the
    // remainder, so this is a moved site rather than a completed deletion.
    expect(exactEditState('unrelated:\n', withEntries, remainder, 1)).toBe('invalid')
  })

  it('requires a replacement to leave no source form and the exact target count', () => {
    expect(exactEditState('a = 1\n', 'a = 1', 'b = 2', 1)).toBe('pending')
    expect(exactEditState('b = 2\n', 'a = 1', 'b = 2', 1)).toBe('applied')
    expect(exactEditState('b = 2\nb = 2\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
    // A moved or partially applied site: neither state is complete.
    expect(exactEditState('a = 1\nb = 2\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
    expect(exactEditState('x\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
  })
})
