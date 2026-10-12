/** Cordis Loader configuration file discovery. */

import { globSync } from 'node:fs'

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
