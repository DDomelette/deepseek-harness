/**
 * Enforce intra-package domain layering inside `packages/client/*\/src/client/`.
 * verify-module-graph covers package-level edges; this gate covers the
 * directory level: domain directories may import `contract/` and never each
 * other, and only the assembly point (`apply.ts` / `index.ts`) may import
 * across domains.
 *
 * Layer model (lower may not import higher):
 *   0  contract/            shared contract API (types + slot declarations)
 *   1  <domain>/ + service  domain implementations (skeleton/, chat/, ...)
 *   2  apply.ts, index.ts   assembly point and re-export shell
 *
 * The gate is a ratchet: `scripts/client-domain-graph.baseline.json` records
 * the violations accepted before the ratchet existed. A run fails on a
 * violation missing from the baseline and on a baseline entry that no longer
 * reproduces, so the recorded set only shrinks on purpose. Regenerate it after
 * fixing violations:
 *   pnpm exec tsx scripts/verify-client-domain-graph.ts --write
 *
 * Run the check directly:
 *   pnpm exec tsx scripts/verify-client-domain-graph.ts
 */

import { globSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, resolve, sep } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')

/** Repository-relative location of the accepted-violation baseline. */
export const BASELINE_PATH = 'scripts/client-domain-graph.baseline.json'

/** Corpus floor; a narrowed checkout must fail instead of reporting a clean ratchet. */
const MINIMUM_CLIENT_SOURCES = 500

/** Directory names treated as the shared contract layer (importable by all). */
const CONTRACT_DIRS = new Set(['contract'])
/** Top-level client files allowed to import across domains (assembly layer). */
const ASSEMBLY_FILES = new Set(['apply.ts', 'index.ts', 'index.tsx'])

/** One cross-domain import that the layering rules reject. */
export interface Violation {
  /** Repository-relative path of the importing module, `/`-separated. */
  file: string
  /** Relative module specifier exactly as the importer wrote it. */
  imported: string
  /** Layering rule the import breaks. */
  reason: string
}

/** One accepted violation as recorded in the baseline file. */
interface BaselineEntry {
  /** Repository-relative path of the importing module, `/`-separated. */
  file: string
  /** Relative module specifier exactly as the importer wrote it. */
  imported: string
}

/** Violations grouped against the accepted baseline. */
interface Ratchet {
  /** Violations absent from the baseline. */
  added: Violation[]
  /** Baseline entries that no longer reproduce. */
  stale: BaselineEntry[]
}

/**
 * Resolve one relative import to a `src/client`-relative path.
 * @param file - Importing file relative to `src/client`.
 * @param specifier - Relative module specifier from that file.
 * @returns Normalized path, preserving leading `..` segments outside `src/client`.
 */
export function resolveClientImport(file: string, specifier: string): string {
  return posix.normalize(posix.join(posix.dirname(file), specifier))
}

/**
 * List the module specifiers one Client source imports.
 *
 * Syntax-aware so that a specifier inside a comment, string, or unrelated
 * `from` token is never mistaken for an import, and so side-effect imports,
 * re-exports, `import = require(...)`, and dynamic `import()` all count.
 * @param file - Source path relative to `src/client`, used to pick the parser dialect.
 * @param sourceText - TypeScript or TSX source.
 * @returns Module specifiers in source order.
 */
export function importedSpecifiers(file: string, sourceText: string): string[] {
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const specifiers: string[] = []
  const record = (node: ts.Node | undefined): void => {
    if (node !== undefined && ts.isStringLiteralLike(node)) specifiers.push(node.text)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) record(node.moduleSpecifier)
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      record(node.moduleReference.expression)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      record(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specifiers
}

/** First path segment of a client-relative file, or '' for top-level files. */
function domainOf(rel: string): string {
  const ix = rel.indexOf('/')
  return ix === -1 ? '' : rel.slice(0, ix)
}

/**
 * Apply the layering rules to one Client source file.
 * @param packageName - Client package directory name under `packages/client`.
 * @param rel - Source path relative to that package's `src/client`, `/`-separated.
 * @param sourceText - TypeScript or TSX source.
 * @returns Violations in source order.
 */
export function findDomainViolations(packageName: string, rel: string, sourceText: string): Violation[] {
  const fromDomain = domainOf(rel)
  const isAssembly = fromDomain === '' && ASSEMBLY_FILES.has(rel)
  if (isAssembly) return []
  const violations: Violation[] = []
  for (const spec of importedSpecifiers(rel, sourceText)) {
    if (!spec.startsWith('.')) continue // package specifiers are verify-module-graph's concern
    const target = resolveClientImport(rel, spec)
    if (target === '..' || target.startsWith('../')) continue // package-level rules govern
    const toDomain = domainOf(target)
    if (toDomain === '' || CONTRACT_DIRS.has(toDomain)) continue // top-level shared file or contract layer
    if (fromDomain === toDomain) continue // inside one domain
    violations.push({
      file: `packages/client/${packageName}/src/client/${rel}`,
      imported: spec,
      reason: fromDomain === ''
        ? `top-level non-assembly file imports domain "${toDomain}" (only apply/index may assemble)`
        : `domain "${fromDomain}" imports sibling domain "${toDomain}" (route shared API through contract/)`,
    })
  }
  return violations
}

/** Stable ratchet identity of one violation: importer and specifier, no line numbers. */
function identity(entry: BaselineEntry): string {
  return `${entry.file} -> ${entry.imported}`
}

function compareEntries(left: BaselineEntry, right: BaselineEntry): number {
  const byFile = left.file < right.file ? -1 : left.file > right.file ? 1 : 0
  if (byFile !== 0) return byFile
  return left.imported < right.imported ? -1 : left.imported > right.imported ? 1 : 0
}

/** Packages under `packages/client` that expose a `src/client` half. */
function clientPackages(dir: string): string[] {
  return readdirSync(dir).filter((pkg) => {
    try {
      return statSync(join(dir, pkg, 'src/client')).isDirectory()
    } catch {
      // Package without a Client half — nothing to layer-check.
      return false
    }
  }).sort()
}

/**
 * Collect every violation in the Client packages of one checkout.
 * @param repoRoot - Repository root to scan.
 * @param minimum - Corpus floor; a smaller discovery result fails instead of reporting clean.
 * @returns Unique violations, sorted by importer then specifier, and the scanned source count.
 */
export function collectViolations(
  repoRoot: string,
  minimum: number = MINIMUM_CLIENT_SOURCES,
): { violations: Violation[]; sources: number } {
  const clientDir = join(repoRoot, 'packages/client')
  const unique = new Map<string, Violation>()
  let sources = 0
  for (const pkg of clientPackages(clientDir)) {
    const packageClientDir = join(clientDir, pkg, 'src/client')
    for (const rel of globSync('**/*.{ts,tsx}', { cwd: packageClientDir })
      .map(file => file.split(sep).join('/'))
      // Retained pre-split copies are reference material, not live layers.
      .filter(file => !file.slice(file.lastIndexOf('/') + 1).includes('.legacy.'))
      .sort()) {
      sources += 1
      const sourceText = readFileSync(join(packageClientDir, rel), 'utf8')
      for (const violation of findDomainViolations(pkg, rel, sourceText)) {
        const key = identity(violation)
        if (!unique.has(key)) unique.set(key, violation)
      }
    }
  }
  if (sources < minimum) {
    throw new Error(
      `verify-client-domain-graph: discovery narrowed to ${sources} Client source file(s); expected at least ${minimum}.`,
    )
  }
  return { violations: [...unique.values()].sort(compareEntries), sources }
}

/**
 * Render the accepted-violation baseline file.
 * @param violations - Violations to record; duplicates collapse to one entry.
 * @returns JSON text with one sorted entry per violation identity and a trailing newline.
 */
export function baselineText(violations: readonly Violation[]): string {
  const entries = [...new Map(violations.map(violation =>
    [identity(violation), { file: violation.file, imported: violation.imported }])).values()]
    .sort(compareEntries)
  return `${JSON.stringify({ version: 1, entries }, null, 2)}\n`
}

/**
 * Read the accepted-violation baseline.
 * @param text - Baseline file contents; `undefined` when the file is absent.
 * @returns Recorded entries, empty when no baseline is checked in.
 */
export function parseBaseline(text: string | undefined): BaselineEntry[] {
  if (text === undefined) return []
  const parsed: unknown = JSON.parse(text)
  const recorded = typeof parsed === 'object' && parsed !== null
    ? (parsed as { entries?: unknown }).entries
    : undefined
  if (!Array.isArray(recorded)) {
    throw new Error(`verify-client-domain-graph: ${BASELINE_PATH} must hold an "entries" array.`)
  }
  return recorded.map((raw: unknown) => {
    const entry = (typeof raw === 'object' && raw !== null ? raw : {}) as { file?: unknown; imported?: unknown }
    if (typeof entry.file !== 'string' || typeof entry.imported !== 'string') {
      throw new Error(`verify-client-domain-graph: ${BASELINE_PATH} entries need string "file" and "imported".`)
    }
    return { file: entry.file, imported: entry.imported }
  })
}

/**
 * Split observed violations into new ones and baselined ones that vanished.
 * @param violations - Violations present in this checkout.
 * @param baseline - Accepted violations recorded in the baseline file.
 * @returns the two ratchet failures; both empty when the checkout matches the baseline.
 */
export function compareToBaseline(
  violations: readonly Violation[],
  baseline: readonly BaselineEntry[],
): Ratchet {
  const observed = new Set(violations.map(identity))
  const accepted = new Set(baseline.map(identity))
  return {
    added: violations.filter(violation => !accepted.has(identity(violation))),
    stale: baseline
      .filter(entry => !observed.has(identity(entry)))
      .map(entry => ({ file: entry.file, imported: entry.imported })),
  }
}

function readBaselineFile(repoRoot: string): string | undefined {
  try {
    return readFileSync(join(repoRoot, BASELINE_PATH), 'utf8')
  } catch {
    // No baseline checked in yet — every violation counts as new.
    return undefined
  }
}

/**
 * Run the ratchet for one checkout.
 * @param args - CLI arguments; `--write` (alias `--update-baseline`) rewrites the baseline.
 * @param repoRoot - Repository root to scan.
 * @param minimum - Corpus floor passed through to discovery.
 * @returns Process exit code; 0 when the checkout matches the baseline.
 */
export function runDomainGraph(
  args: readonly string[],
  repoRoot: string = root,
  minimum: number = MINIMUM_CLIENT_SOURCES,
): number {
  const unknown = args.filter(arg => arg !== '--write' && arg !== '--update-baseline')
  if (unknown.length > 0) {
    console.error(`verify-client-domain-graph: unknown argument(s) ${unknown.join(' ')}; expected --write.`)
    return 1
  }
  const write = args.length > 0
  const { violations, sources } = collectViolations(repoRoot, minimum)
  if (write) {
    mkdirSync(dirname(join(repoRoot, BASELINE_PATH)), { recursive: true })
    writeFileSync(join(repoRoot, BASELINE_PATH), baselineText(violations))
    console.log(`verify-client-domain-graph: wrote ${violations.length} accepted violation(s) to ${BASELINE_PATH}.`)
    return 0
  }

  const { added, stale } = compareToBaseline(violations, parseBaseline(readBaselineFile(repoRoot)))
  if (added.length > 0) {
    console.error(`verify-client-domain-graph: ${added.length} new violation(s) absent from ${BASELINE_PATH}:`)
    for (const violation of added) console.error(`  ${violation.file} -> ${violation.imported}\n    ${violation.reason}`)
  }
  if (stale.length > 0) {
    console.error(`verify-client-domain-graph: ${stale.length} baseline entr(y/ies) no longer reproduce; run \`pnpm exec tsx scripts/verify-client-domain-graph.ts --write\` to shrink ${BASELINE_PATH}:`)
    for (const entry of stale) console.error(`  ${identity(entry)}`)
  }
  if (added.length > 0 || stale.length > 0) return 1

  console.log(`verify-client-domain-graph: ${sources} Client source file(s) match the ${violations.length} accepted violation(s).`)
  return 0
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) process.exitCode = runDomainGraph(process.argv.slice(2))
