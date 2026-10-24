/** Cordis Loader configuration file discovery and reading. */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * Return repository-relative Cordis Loader YAML paths under `root`.
 *
 * Translation consistency records are YAML sidecars, never Loader inputs. The
 * shipped Agent-preset declarations are named `<preset>.patch.yml`, which the
 * `*cordis*` convention does not reach, so their directory is listed too.
 *
 * @param root Repository root to scan.
 * @returns Sorted repository-relative Loader configuration paths.
 */
export function cordisConfigFiles(root: string): string[] {
  return globSync(['**/*cordis*.yml', '**/*cordis*.yaml', 'packages/bundle/*/presets/*.patch.yml'], {
    cwd: root,
    exclude: ['.claude/**', 'node_modules/**', 'vendor/**', '**/*.i18n.yaml'],
  }).sort()
}

/**
 * Read one Loader YAML file, following a shared alias a checkout materialized
 * as text.
 *
 * A composition may expose another file through a symbolic link. A Git
 * checkout without symbolic-link support (`core.symlinks` false, the Windows
 * default) writes the relative target as the file's whole content instead, so
 * parsing that text reports the target path as an invalid Loader document. A
 * single-line relative path is therefore resolved against the file's own
 * directory; a real symbolic link, or any ordinary document, is returned
 * unchanged because the read already followed it.
 *
 * @param root - repository root the corpus paths are relative to.
 * @param file - repository-relative Loader configuration path.
 * @returns the file's YAML text, or the aliased target's content.
 * @throws when the materialized text names a target this checkout lacks.
 */
export function readCordisConfigFile(root: string, file: string): string {
  const path = resolve(root, file)
  const content = readFileSync(path, 'utf8')
  if (content.includes('\n')) return content
  const target = content.trim()
  if (!target.startsWith('./') && !target.startsWith('../')) return content
  const resolved = resolve(dirname(path), target)
  if (!existsSync(resolved)) {
    throw new Error(`${file}: the materialized symbolic-link target "${target}" does not exist`)
  }
  return readFileSync(resolved, 'utf8')
}
