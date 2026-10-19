/** Tests for Client domain layering discovery and the accepted-violation ratchet. */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  baselineText,
  compareToBaseline,
  findDomainViolations,
  importedSpecifiers,
  parseBaseline,
  resolveClientImport,
  runDomainGraph,
  type Violation,
} from './verify-client-domain-graph.ts'

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

/** Build a throwaway checkout holding the given Client sources. */
function checkout(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-client-domain-graph-'))
  roots.push(root)
  for (const [rel, content] of Object.entries(files)) writeFile(root, rel, content)
  return root
}

/** Run the ratchet with console output captured. */
function run(args: readonly string[], root: string, minimum = 1): { code: number; output: string } {
  const lines: string[] = []
  for (const method of ['log', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...parts: unknown[]) => {
      lines.push(parts.map(String).join(' '))
    })
  }
  const code = runDomainGraph(args, root, minimum)
  return { code, output: lines.join('\n') }
}

const SCRATCH = 'packages/client/ui-demo/src/client/queue/Scratch.ts'

describe('client domain import resolution', () => {
  it('preserves imports that leave src/client from a top-level file', () => {
    expect(resolveClientImport('styles.ts', '../styles/base.css?inline'))
      .toBe('../styles/base.css?inline')
  })

  it('normalizes imports between domains inside src/client', () => {
    expect(resolveClientImport('input/hub.ts', '../queue/store.ts'))
      .toBe('queue/store.ts')
  })
})

describe('client domain import discovery', () => {
  it('admits every module-loading form and ignores lookalikes in comments and strings', () => {
    const source = [
      "import { a } from './static.ts'",
      "import './side-effect.module.css'",
      "export { b } from './re-export.ts'",
      "import c = require('./require-equals.ts')",
      "const d = await import('./dynamic.ts')",
      "// import { e } from './commented.ts'",
      String.raw`const text = "from './string.ts'"`,
    ].join('\n')

    expect(importedSpecifiers('x.ts', source)).toEqual([
      './static.ts',
      './side-effect.module.css',
      './re-export.ts',
      './require-equals.ts',
      './dynamic.ts',
    ])
  })

  it('parses TSX so JSX never truncates the discovered imports', () => {
    const source = "import styles from '../rows/Rows.module.css'\nexport const Row = () => <div className={styles.row} />\n"

    expect(importedSpecifiers('queue/Row.tsx', source)).toEqual(['../rows/Rows.module.css'])
  })
})

describe('client domain layering', () => {
  const violations = (rel: string, source: string): Violation[] => findDomainViolations('ui-demo', rel, source)

  it('rejects a domain importing a sibling domain', () => {
    expect(violations('queue/store.ts', "import { row } from '../rows/row.ts'")).toEqual([{
      file: 'packages/client/ui-demo/src/client/queue/store.ts',
      imported: '../rows/row.ts',
      reason: 'domain "queue" imports sibling domain "rows" (route shared API through contract/)',
    }])
  })

  it('rejects a top-level non-assembly file importing a domain', () => {
    expect(violations('theme.ts', "import './queue/store.ts'")).toEqual([{
      file: 'packages/client/ui-demo/src/client/theme.ts',
      imported: './queue/store.ts',
      reason: 'top-level non-assembly file imports domain "queue" (only apply/index may assemble)',
    }])
  })

  it('admits contract, same-domain, assembly, and top-level shared imports', () => {
    const admitted = [
      findDomainViolations('ui-demo', 'queue/store.ts', "import type { Row } from '../contract/rows.ts'"),
      findDomainViolations('ui-demo', 'queue/store.ts', "import './adjacent.ts'"),
      findDomainViolations('ui-demo', 'apply.ts', "import './rows/row.ts'"),
      findDomainViolations('ui-demo', 'index.ts', "import type { Row } from './rows/row.ts'"),
      findDomainViolations('ui-demo', 'queue/store.ts', "import { x } from './theme.ts'"),
      findDomainViolations('ui-demo', 'queue/store.ts', "import { x } from './rows/../theme.ts'"),
    ]

    expect(admitted).toEqual([[], [], [], [], [], []])
  })

  it('leaves package specifiers and imports above src/client to the package-level gates', () => {
    const outside = [
      findDomainViolations('ui-demo', 'queue/store.ts', "import { x } from '@deepseek-ai/dsh-client-web/client'"),
      findDomainViolations('ui-demo', 'queue/store.ts', "import { x } from '../../rows/row.ts'"),
      findDomainViolations('ui-demo', 'queue/store.ts', "import { x } from '../../../other-package/src/client/rows/row.ts'"),
    ]

    expect(outside).toEqual([[], [], []])
  })
})

describe('accepted-violation ratchet', () => {
  const accepted: Violation = {
    file: SCRATCH,
    imported: '../rows/row.ts',
    reason: 'domain "queue" imports sibling domain "rows"',
  }

  it('serializes one stable, sorted entry per importer and specifier', () => {
    const later: Violation = {
      file: 'packages/client/ui-demo/src/client/queue/Zed.ts',
      imported: '../rows/row.ts',
      reason: 'ignored',
    }
    expect(baselineText([later, accepted, accepted])).toBe(`${JSON.stringify({
      version: 1,
      entries: [
        { file: accepted.file, imported: accepted.imported },
        { file: later.file, imported: later.imported },
      ],
    }, null, 2)}\n`)
    expect(parseBaseline(baselineText([accepted]))).toEqual([{ file: SCRATCH, imported: '../rows/row.ts' }])
  })

  it('rejects a baseline without entries', () => {
    expect(() => parseBaseline('{"version":1}')).toThrow(/"entries" array/u)
    expect(() => parseBaseline('{"entries":[{"file":"a"}]}')).toThrow(/string "file" and "imported"/u)
  })

  it('treats a missing baseline as empty', () => {
    expect(parseBaseline(undefined)).toEqual([])
  })

  it('reports new violations and baseline entries that stopped reproducing', () => {
    const restored = compareToBaseline([accepted], [accepted])
    expect(restored).toEqual({ added: [], stale: [] })

    const fresh: Violation = { ...accepted, imported: '../rows/other.ts' }
    const drifted = compareToBaseline([accepted, fresh], [{ ...accepted, file: 'packages/client/ui-demo/src/client/queue/Gone.ts' }])
    expect(drifted.added).toEqual([accepted, fresh])
    expect(drifted.stale).toEqual([{ file: 'packages/client/ui-demo/src/client/queue/Gone.ts', imported: accepted.imported }])
  })

  it('fails on a new violation, passes once written, and fails when an entry stops reproducing', () => {
    const source = "import { rows } from '../rows/row.ts'\n"
    const root = checkout({ [SCRATCH]: source })

    const first = run([], root)
    expect(first.code).toBe(1)
    expect(first.output).toContain(`${SCRATCH} -> ../rows/row.ts`)
    expect(first.output).toContain('1 new violation(s) absent from')

    expect(run(['--write'], root).code).toBe(0)
    expect(parseBaseline(readFileSync(join(root, 'scripts/client-domain-graph.baseline.json'), 'utf8')))
      .toEqual([{ file: SCRATCH, imported: '../rows/row.ts' }])

    expect(run([], root).code).toBe(0)

    writeFile(root, SCRATCH, "import { own } from './local.ts'\n")
    const shrunk = run([], root)
    expect(shrunk.code).toBe(1)
    expect(shrunk.output).toContain('1 baseline entr(y/ies) no longer reproduce')
    expect(shrunk.output).toContain('--write')
  })

  it('refuses a narrowed corpus instead of reporting a clean ratchet', () => {
    const root = checkout({ [SCRATCH]: 'export const x = 1\n' })

    expect(() => run([], root, 500)).toThrow(/discovery narrowed to 1 Client source file/u)
  })

  it('rejects an unknown argument instead of silently checking', () => {
    const root = checkout({ [SCRATCH]: 'export const x = 1\n' })

    expect(run(['--writ'], root)).toEqual({
      code: 1,
      output: 'verify-client-domain-graph: unknown argument(s) --writ; expected --write.',
    })
  })
})
