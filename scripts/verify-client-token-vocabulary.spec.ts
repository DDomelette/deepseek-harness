/** Tests for the undefined `--dsw-*` token gate. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectVocabulary,
  COMPONENT_LOCAL_PROPERTIES,
  declaredTokens,
  isExcludedPath,
  runTokenVocabulary,
  sourceReferences,
  stylesheetReferences,
} from './verify-client-token-vocabulary.ts'

const roots: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Write one file into a temporary checkout, creating parent directories. */
function writeFile(root: string, rel: string, content: string): void {
  const path = join(root, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** Build a throwaway checkout holding the given files. */
function checkout(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-client-token-vocabulary-'))
  roots.push(root)
  for (const [rel, content] of Object.entries(files)) writeFile(root, rel, content)
  return root
}

/** Theme sheet declaring the shared tokens one throwaway checkout needs. */
const THEME = [
  ':root {',
  '  --dsw-alias-bg-base: #fff;',
  '  --dsw-alias-label-primary: #111;',
  '}',
  '',
].join('\n')

/** Floor that admits a checkout holding one sheet with one reference. */
const FLOOR = { stylesheets: 1, references: 1 }

/** Run the gate with console output captured. */
function run(args: readonly string[], root: string, floor = FLOOR): { code: number; output: string } {
  const lines: string[] = []
  for (const method of ['log', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...parts: unknown[]) => {
      lines.push(parts.map(String).join(' '))
    })
  }
  const code = runTokenVocabulary(args, root, floor)
  return { code, output: lines.join('\n') }
}

const THEME_SHEET = 'packages/client/ui-theme/src/styles/base.css'
const FEATURE_SHEET = 'packages/client/ui-demo/src/client/Demo.module.css'

describe('token declaration scanning', () => {
  it('collects declared names and ignores declarations inside comments', () => {
    const css = [
      ':root {',
      '  --dsw-alias-bg-base: #fff;',
      '  --dsw-alias-label-primary: var(--dsw-alias-bg-base);',
      '}',
      '/* --dsw-alias-commented-out: #000; */',
    ].join('\n')

    expect(declaredTokens(css)).toEqual(['--dsw-alias-bg-base', '--dsw-alias-label-primary'])
  })

  it('reports the line of every reference and skips commented-out ones', () => {
    const css = [
      '.a { color: var(--dsw-alias-label-primary); }',
      '/* .b { color: var(--dsw-alias-gone); } */',
      '.c {',
      '  background: var(--dsw-alias-bg-base);',
      '}',
    ].join('\n')

    expect(stylesheetReferences(FEATURE_SHEET, css)).toEqual([
      { file: FEATURE_SHEET, line: 1, token: '--dsw-alias-label-primary' },
      { file: FEATURE_SHEET, line: 4, token: '--dsw-alias-bg-base' },
    ])
  })

  it('reads string literals in TypeScript, including JSX attributes, but not comments', () => {
    const source = [
      '// var(--dsw-alias-commented) is prose',
      "const style = 'color: var(--dsw-alias-label-primary)'",
      'export const fill = <path fill="var(--dsw-alias-bg-base)" />',
    ].join('\n')

    expect(sourceReferences('packages/client/ui-demo/src/client/demo.tsx', source)).toEqual([
      { file: 'packages/client/ui-demo/src/client/demo.tsx', line: 2, token: '--dsw-alias-label-primary' },
      { file: 'packages/client/ui-demo/src/client/demo.tsx', line: 3, token: '--dsw-alias-bg-base' },
    ])
  })
})

describe('corpus boundary', () => {
  it('excludes test, fixture, build, and declaration sources', () => {
    const excluded = [
      'packages/client/ui-demo/tests/Demo.module.css',
      'packages/client/ui-demo/src/client/__tests__/demo.ts',
      'packages/client/ui-demo/src/client/fixtures/demo.css',
      'packages/client/ui-demo/src/client/demo.client.spec.ts',
      'packages/client/ui-demo/src/client/demo.e2e.ts',
      'packages/client/ui-demo/src/client/demo.fixture.ts',
      'packages/client/ui-demo/lib/client.css',
      'packages/client/ui-demo/dist/client.css',
      'packages/client/ui-demo/node_modules/dep/demo.css',
      'packages/client/ui-demo/src/client/demo.d.ts',
    ]

    expect(excluded.filter(file => !isExcludedPath(file))).toEqual([])
    expect(isExcludedPath(FEATURE_SHEET)).toBe(false)
  })

  it('keeps a spec fixture string out of the scan instead of allowlisting it', () => {
    const root = checkout({
      [THEME_SHEET]: THEME,
      [FEATURE_SHEET]: '.a { color: var(--dsw-alias-label-primary); }\n',
      'packages/client/ui-theme/tests/radius-styles.client.spec.ts':
        "expect(unscaledRadii('.card { border-radius: var(--dsw-radius-missing); }')).toHaveLength(1)\n",
    })

    expect(run([], root)).toMatchObject({ code: 0 })
  })
})

describe('undefined token gate', () => {
  it('passes when every reference names a declared theme token', () => {
    const root = checkout({
      [THEME_SHEET]: THEME,
      [FEATURE_SHEET]: '.a {\n  color: var(--dsw-alias-label-primary);\n}\n',
    })

    expect(run([], root)).toEqual({
      code: 0,
      output: 'verify-client-token-vocabulary: 1 reference(s) in 2 stylesheet(s) and 0 source file(s) resolve against the 2 token(s) packages/client/ui-theme/src/styles declares.',
    })
  })

  it('fails with file, line, and token for a reference no theme sheet defines', () => {
    const root = checkout({
      [THEME_SHEET]: THEME,
      [FEATURE_SHEET]: '.a {\n  border: 0.5px solid var(--dsw-alias-border-secondary);\n}\n',
    })

    const result = run([], root)

    expect(result.code).toBe(1)
    expect(result.output).toContain(`${FEATURE_SHEET}:2: --dsw-alias-border-secondary (no definition)`)
    expect(result.output).toContain('1 reference(s) name a --dsw-* token no theme sheet declares')
    expect(result.output).toContain('COMPONENT_LOCAL_PROPERTIES')
  })

  it('rejects a component-local declaration other sheets cannot inherit', () => {
    const root = checkout({
      [THEME_SHEET]: THEME,
      [FEATURE_SHEET]: '.a {\n  --dsw-alias-local-shadow: 0 0 1px #000;\n  box-shadow: var(--dsw-alias-local-shadow);\n}\n',
    })

    const result = run([], root)

    expect(result.code).toBe(1)
    expect(result.output).toContain(`${FEATURE_SHEET}:3: --dsw-alias-local-shadow (no definition)`)
  })

  it('passes for the allowlisted component-local property', () => {
    expect(COMPONENT_LOCAL_PROPERTIES.has('--dsw-hovercard-bg')).toBe(true)
    const root = checkout({
      [THEME_SHEET]: THEME,
      [FEATURE_SHEET]: '.card {\n  --dsw-hovercard-bg: #2c2c2e;\n}\n.card:hover {\n  background: var(--dsw-hovercard-bg);\n}\n',
    })

    expect(run([], root)).toMatchObject({ code: 0 })
  })

  it('scans TypeScript sources against the same vocabulary', () => {
    const root = checkout({
      [THEME_SHEET]: THEME,
      'packages/client/ui-demo/src/client/demo.ts':
        "// uses var(--dsw-alias-label-primary)\nexport const style = 'color: var(--dsw-alias-border-secondary)'\n",
    })

    const result = run([], root)

    expect(result.code).toBe(1)
    expect(result.output).toContain(
      'packages/client/ui-demo/src/client/demo.ts:2: --dsw-alias-border-secondary (no definition)',
    )
  })

  it('rejects an argument instead of silently checking, because it writes nothing', () => {
    const root = checkout({ [THEME_SHEET]: THEME, [FEATURE_SHEET]: '.a { color: var(--dsw-alias-label-primary); }\n' })

    expect(run(['--write'], root).output).toBe(
      'verify-client-token-vocabulary: unknown argument(s) --write; this gate writes nothing — declare the name in packages/client/ui-theme/src/styles/ instead.',
    )
    expect(run(['--write'], root).code).toBe(1)
  })
})

describe('corpus floors', () => {
  it('refuses a narrowed stylesheet corpus instead of reporting a clean scan', () => {
    const root = checkout({ [THEME_SHEET]: THEME, [FEATURE_SHEET]: '.a { color: var(--dsw-alias-label-primary); }\n' })

    expect(() => collectVocabulary(root, { stylesheets: 150, references: 1 }))
      .toThrow(/discovery narrowed to 2 stylesheet\(s\); expected at least 150/u)
  })

  it('refuses a scan that found suspiciously few references', () => {
    const root = checkout({ [THEME_SHEET]: THEME, [FEATURE_SHEET]: '.a { color: var(--dsw-alias-label-primary); }\n' })

    expect(() => collectVocabulary(root, { stylesheets: 1, references: 2000 }))
      .toThrow(/discovery narrowed to 1 --dsw-\* reference\(s\); expected at least 2000/u)
  })

  it('refuses a checkout without the theme stylesheets', () => {
    const root = checkout({ [FEATURE_SHEET]: '.a { color: var(--dsw-alias-label-primary); }\n' })

    expect(() => collectVocabulary(root, FLOOR))
      .toThrow(/packages\/client\/ui-theme\/src\/styles is missing/u)
  })

  it('refuses a theme stylesheet set that declares nothing', () => {
    const root = checkout({
      [THEME_SHEET]: ':root { --dsh-font-family: sans-serif; }\n',
      [FEATURE_SHEET]: '.a { color: var(--dsw-alias-label-primary); }\n',
    })

    expect(() => collectVocabulary(root, FLOOR)).toThrow(/declares no --dsw-\* token/u)
  })
})
