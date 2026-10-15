/** Experimental package identities, publication policy, and retained npm names. */

/**
 * Existing npm names retained by capabilities now housed under experimental/.
 *
 * These are the three retained names this tree actually keeps under
 * `packages/experimental/`; the other capabilities upstream lists there still
 * live at their own group directories here (`packages/webhook/*`,
 * `packages/terminal/tool-terminal`, `packages/workflow/tool-ralph`,
 * `packages/skill/skill-badge`, `packages/session-query/tool-session-query`,
 * `packages/session/session-title-all-prompts-llm`), so they are ordinary
 * packages rather than retained experimental identities.
 */
export const EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS: Readonly<Record<string, string>> = {
  'packages/experimental/hook-protocol': '@deepseek-ai/dsh-hook-protocol',
  'packages/experimental/hooks-claude-code': '@deepseek-ai/dsh-hooks-claude-code',
  'packages/experimental/hooks-codex': '@deepseek-ai/dsh-hooks-codex',
} satisfies Record<`packages/experimental/${string}`, `@deepseek-ai/dsh-${string}`>

/** npm namespace for experimental packages without retained-name exceptions. */
export const EXPERIMENTAL_PACKAGE_NAME_PREFIX = '@deepseek-ai/dsh-experimental-'
const retainedNames = new Set(Object.values(EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS))

/**
 * Identify an experimental npm package independently of its installed directory.
 * @param name - complete npm package name, without a version or subpath.
 * @returns Whether the name uses the experimental prefix or a retained name.
 */
export function isExperimentalPackageName(name: string): boolean {
  return name.startsWith(EXPERIMENTAL_PACKAGE_NAME_PREFIX) || retainedNames.has(name)
}

/**
 * Find experimental identities in module ids, paths, subpaths, or npm alias specifications.
 * @param reference - package reference or bundler/runtime module identifier.
 * @returns Whether a delimited package name identifies an experimental capability.
 */
export function hasExperimentalPackageReference(reference: string): boolean {
  const normalized = reference.replaceAll('\\', '/')
  return [...normalized.matchAll(/(?:^|[/:\u0000])(@deepseek-ai\/[^/@?#:\s]+)(?=$|[/@?#:])/g)]
    .some(([, name]) => name !== undefined && isExperimentalPackageName(name))
}

/**
 * Derive the package-owned plugin record namespace without changing persisted names.
 * @param name - complete experimental npm package name.
 * @returns Capability suffix, or undefined for a non-experimental name.
 */
export function experimentalPackageRecordNamespace(name: string): string | undefined {
  if (!isExperimentalPackageName(name)) return undefined
  return name.slice(name.startsWith(EXPERIMENTAL_PACKAGE_NAME_PREFIX) ? EXPERIMENTAL_PACKAGE_NAME_PREFIX.length : '@deepseek-ai/dsh-'.length)
}

/**
 * Experimental packages excluded from public releases and npm baselines.
 *
 * Upstream publishes experimental packages by default; this fork keeps them
 * private, so every experimental capability it owns is listed here. The Python
 * runtime is doubly private: it is the fork's pre-rename copy of the PTC
 * runtime and is scheduled for retirement.
 */
export const PRIVATE_EXPERIMENTAL_PACKAGE_DIRECTORIES: readonly string[] = [
  'packages/experimental/code-runtime-python',
  'packages/experimental/inspector',
  'packages/experimental/webworker-packer',
  'packages/experimental/webworker-runtime',
]

/**
 * Whether an experimental package publishes under the default-public policy.
 * @param directory - repository-relative package directory.
 * @param privateDirectories - experimental directories excluded from publication.
 * @returns Whether the package publishes with the dsh family.
 */
export function isPublicExperimentalPackageDirectory(
  directory: string,
  privateDirectories: readonly string[] = PRIVATE_EXPERIMENTAL_PACKAGE_DIRECTORIES,
): boolean {
  return /^packages\/experimental\/[^/]+$/.test(directory)
    && !privateDirectories.includes(directory)
}
