/**
 * Fail when a stylesheet or Client source references a `--dsw-*` custom
 * property that no theme stylesheet declares.
 *
 * A `var(--dsw-*)` whose name nothing defines resolves to its inline fallback,
 * or to the guaranteed-invalid value when it carries none, so the property
 * keeps its initial value and the surface renders as if the declaration were
 * absent. Twenty-one such names shipped before
 * `.agents/notes/implemented/bug-fix/2026-10-19-dsw-token-vocabulary-reconciled.md`
 * repaired them; nothing failed, because the references and the declared
 * vocabulary were only ever compared by hand.
 *
 * Definition authority is `packages/client/ui-theme/src/styles/` — the sheets
 * `docs/web-styling.md` names as the home of shared tokens. A feature sheet
 * that declares its own `--dsw-*` property is not a definition for anyone
 * else: CSS custom properties inherit only through the element tree, so a
 * reference from another sheet would read the initial value just the same,
 * and a shared token belongs in the theme sheets. Component-local properties
 * are the one allowed exception and are listed in
 * {@link COMPONENT_LOCAL_PROPERTIES} with the reason each is not a theme token.
 *
 * The scan covers every stylesheet and TypeScript source under `packages/` and
 * `apps/` except build output, installs, and tests, because the vocabulary is
 * shared by the Client packages, the mobile bundle, the extension packages, the
 * notes client, and the app shells. Test and fixture sources are excluded: they
 * hold probe strings such as `--dsw-radius-missing`, which must stay unknown by
 * design. No TypeScript source declares a `--dsw-*` custom property (the
 * `--dsh-*` inline properties are a different namespace), so the sheets are the
 * complete definition set.
 *
 * There is nothing to generate, so the gate has no `--write` mode. Run it
 * directly:
 *   pnpm exec tsx scripts/verify-client-token-vocabulary.ts
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')

/** Repository-relative directory of the theme sheets that own shared tokens. */
export const THEME_STYLESHEETS_DIR = 'packages/client/ui-theme/src/styles'

/**
 * `--dsw-*` properties a component declares and reads for itself; each entry
 * names why the property is not a shared theme token. Keep this list tiny: a
 * token another sheet may read belongs in {@link THEME_STYLESHEETS_DIR}.
 */
export const COMPONENT_LOCAL_PROPERTIES: ReadonlySet<string> = new Set([
  // HoverCard.module.css declares and reads it on its own surface; the hover
  // material is per-instance state, not a decision another sheet may read.
  '--dsw-hovercard-bg',
])

/** Corpus floor; a narrowed checkout or a broken matcher fails instead of reporting clean. */
export const DEFAULT_CORPUS_FLOOR: CorpusFloor = { stylesheets: 150, references: 2000 }

/** Directories whose contents are never source: build output, installs, and test fixtures. */
const EXCLUDED_DIRECTORIES = new Set(['__tests__', 'coverage', 'dist', 'fixtures', 'lib', 'node_modules', 'tests'])
/** Source extensions the scan reads; `.d.ts` declarations are excluded by {@link isExcludedPath}. */
const SCANNED_FILE = /\.(?:css|ts|tsx)$/
/** Test and fixture source naming: probes and expected strings, not shipped styles. */
const EXCLUDED_FILE = /\.(?:spec|test|e2e|fixture)\.[a-z]+$/i
/** One `var(--dsw-*)` reference, with the custom-property name the sheet reads. */
const VAR_REFERENCE = /var\(\s*(--dsw-[\w-]+)/g
/** One custom-property declaration inside a rule body. */
const DECLARATION = /(--dsw-[\w-]+)\s*:/g

/** Top-level trees that carry Client surfaces. */
const SCAN_ROOTS = ['packages', 'apps'] as const

/** Corpus floors a run must clear before its result is reported. */
export interface CorpusFloor {
  /** Minimum tracked stylesheets the scan must enumerate. */
  stylesheets: number
  /** Minimum `var(--dsw-*)` references the scan must find. */
  references: number
}

/** One `var(--dsw-*)` reference in the scanned corpus. */
export interface TokenReference {
  /** Repository-relative path, `/`-separated. */
  file: string
  /** One-based source line of the reference. */
  line: number
  /** Referenced custom-property name, including the leading `--`. */
  token: string
}

/** Everything one scan observes about the token vocabulary. */
export interface TokenVocabulary {
  /** Every reference found outside excluded test sources. */
  references: TokenReference[]
  /** Every `--dsw-*` name the theme sheets declare. */
  defined: Set<string>
  /** Stylesheets scanned, including those that reference no token. */
  stylesheets: number
  /** TypeScript and TSX sources scanned. */
  sources: number
}

/**
 * Report whether a repository-relative path is outside the scanned corpus.
 * @param file - repository-relative path, `/`-separated.
 * @returns true for test/fixture sources, type declarations, and build output.
 */
export function isExcludedPath(file: string): boolean {
  const segments = file.split('/')
  if (segments.some(segment => EXCLUDED_DIRECTORIES.has(segment))) return true
  const base = segments[segments.length - 1] ?? ''
  return base.endsWith('.d.ts') || EXCLUDED_FILE.test(base)
}

/** Replace CSS comments with spaces, keeping newlines so line numbers hold. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '))
}

/** Offset of every line start in one text. */
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    starts.push(index + 1)
  }
  return starts
}

/**
 * One-based line containing an offset.
 * @param starts - `lineStarts` result for the same text.
 * @param offset - zero-based character offset.
 * @returns the one-based line number.
 */
function lineAt(starts: readonly number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if ((starts[middle] ?? 0) <= offset) low = middle
    else high = middle - 1
  }
  return low + 1
}

/**
 * Collect the `--dsw-*` names one theme sheet declares.
 * @param css - stylesheet text; comments are ignored.
 * @returns declared names in source order, duplicates included.
 */
export function declaredTokens(css: string): string[] {
  return [...stripCssComments(css).matchAll(DECLARATION)].map(([, token = '']) => token)
}

/**
 * Collect the `--dsw-*` references one stylesheet makes.
 * @param file - repository-relative path used in the diagnostic.
 * @param css - stylesheet text; commented-out references are ignored.
 * @returns one reference per `var()` call, in source order.
 */
export function stylesheetReferences(file: string, css: string): TokenReference[] {
  const stripped = stripCssComments(css)
  const starts = lineStarts(stripped)
  return [...stripped.matchAll(VAR_REFERENCE)].map((match): TokenReference => ({
    file,
    line: lineAt(starts, match.index),
    token: match[1] ?? '',
  }))
}

/**
 * Collect the `--dsw-*` references one TypeScript source makes.
 *
 * Only string and template literal contents count, so a reference inside a
 * comment is not mistaken for one, while inline styles, JSX attributes, and
 * prompt text that teaches a token are scanned. The reported line is the
 * reference's own line inside the literal.
 * @param file - repository-relative path used in the diagnostic.
 * @param sourceText - TypeScript or TSX source.
 * @returns one reference per `var()` call, in source order.
 */
export function sourceReferences(file: string, sourceText: string): TokenReference[] {
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const starts = lineStarts(sourceText)
  const references: TokenReference[] = []
  const collect = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node)
      || ts.isNoSubstitutionTemplateLiteral(node)
      || node.kind === ts.SyntaxKind.TemplateHead
      || node.kind === ts.SyntaxKind.TemplateMiddle
      || node.kind === ts.SyntaxKind.TemplateTail
    ) {
      const start = node.getStart(source)
      const raw = sourceText.slice(start, node.getEnd())
      for (const match of raw.matchAll(VAR_REFERENCE)) {
        references.push({ file, line: lineAt(starts, start + match.index), token: match[1] ?? '' })
      }
    }
    ts.forEachChild(node, collect)
  }
  collect(source)
  return references
}

/** Every scanned file under one checkout, sorted for a deterministic report. */
function scannedFiles(repoRoot: string): string[] {
  const files: string[] = []
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relPath = `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) walk(join(dir, entry.name), relPath)
      } else if (entry.isFile() && SCANNED_FILE.test(entry.name) && !isExcludedPath(relPath)) {
        files.push(relPath)
      }
    }
  }
  for (const scanRoot of SCAN_ROOTS) {
    const dir = join(repoRoot, scanRoot)
    if (existsSync(dir) && statSync(dir).isDirectory()) walk(dir, scanRoot)
  }
  return files.sort()
}

/**
 * Scan one checkout for token references and declarations.
 * @param repoRoot - repository root to scan.
 * @param floor - corpus floors the scan must clear.
 * @returns the scanned vocabulary and the corpus counts behind it.
 */
export function collectVocabulary(
  repoRoot: string,
  floor: CorpusFloor = DEFAULT_CORPUS_FLOOR,
): TokenVocabulary {
  const themeDir = join(repoRoot, THEME_STYLESHEETS_DIR)
  if (!existsSync(themeDir)) {
    throw new Error(`verify-client-token-vocabulary: ${THEME_STYLESHEETS_DIR} is missing; it declares the shared --dsw-* vocabulary.`)
  }
  const references: TokenReference[] = []
  const defined = new Set<string>()
  let stylesheets = 0
  let sources = 0
  for (const file of scannedFiles(repoRoot)) {
    const text = readFileSync(join(repoRoot, file), 'utf8')
    if (file.endsWith('.css')) {
      stylesheets += 1
      if (file.startsWith(`${THEME_STYLESHEETS_DIR}/`)) {
        for (const token of declaredTokens(text)) defined.add(token)
      }
      references.push(...stylesheetReferences(file, text))
    } else {
      sources += 1
      if (text.includes('--dsw-')) references.push(...sourceReferences(file, text))
    }
  }
  if (defined.size === 0) {
    throw new Error(`verify-client-token-vocabulary: ${THEME_STYLESHEETS_DIR} declares no --dsw-* token; the definition scan is broken.`)
  }
  if (stylesheets < floor.stylesheets) {
    throw new Error(
      `verify-client-token-vocabulary: discovery narrowed to ${stylesheets} stylesheet(s); expected at least ${floor.stylesheets}.`,
    )
  }
  if (references.length < floor.references) {
    throw new Error(
      `verify-client-token-vocabulary: discovery narrowed to ${references.length} --dsw-* reference(s); expected at least ${floor.references}.`,
    )
  }
  return { references, defined, stylesheets, sources }
}

/**
 * Split references into those the vocabulary and the allowlist satisfy.
 * @param references - references found by a scan.
 * @param defined - names the theme sheets declare.
 * @param allowed - component-local properties accepted without a theme definition.
 * @returns the references naming a token neither source defines, sorted by file then line.
 */
export function undefinedReferences(
  references: readonly TokenReference[],
  defined: ReadonlySet<string>,
  allowed: ReadonlySet<string> = COMPONENT_LOCAL_PROPERTIES,
): TokenReference[] {
  return references
    .filter(reference => !defined.has(reference.token) && !allowed.has(reference.token))
    .sort((left, right) => left.file < right.file
      ? -1
      : left.file > right.file
        ? 1
        : left.line - right.line || left.token.localeCompare(right.token))
}

/**
 * Run the gate for one checkout.
 * @param args - CLI arguments; the gate takes none because it writes nothing.
 * @param repoRoot - repository root to scan.
 * @param floor - corpus floors passed through to discovery.
 * @returns process exit code; 0 when every reference names a declared token.
 */
export function runTokenVocabulary(
  args: readonly string[],
  repoRoot: string = root,
  floor: CorpusFloor = DEFAULT_CORPUS_FLOOR,
): number {
  if (args.length > 0) {
    console.error(
      `verify-client-token-vocabulary: unknown argument(s) ${args.join(' ')}; this gate writes nothing — declare the name in ${THEME_STYLESHEETS_DIR}/ instead.`,
    )
    return 1
  }
  const { references, defined, stylesheets, sources } = collectVocabulary(repoRoot, floor)
  const missing = undefinedReferences(references, defined)
  if (missing.length > 0) {
    console.error(
      `verify-client-token-vocabulary: ${missing.length} reference(s) name a --dsw-* token no theme sheet declares:`,
    )
    for (const reference of missing) {
      console.error(`  ${reference.file}:${reference.line}: ${reference.token} (no definition)`)
    }
    console.error(
      `Declare the name in ${THEME_STYLESHEETS_DIR}/, or add it to COMPONENT_LOCAL_PROPERTIES in this script with the reason it is not a theme token.`,
    )
    return 1
  }
  console.log(
    `verify-client-token-vocabulary: ${references.length} reference(s) in ${stylesheets} stylesheet(s) and ${sources} source file(s) resolve against the ${defined.size} token(s) ${THEME_STYLESHEETS_DIR} declares.`,
  )
  return 0
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) {
  process.exitCode = runTokenVocabulary(process.argv.slice(2))
}
