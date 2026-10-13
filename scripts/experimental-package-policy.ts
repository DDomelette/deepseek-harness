/** Experimental packages that publish with the dsh release family without changing names. */
export const PUBLIC_EXPERIMENTAL_PACKAGE_DIRECTORIES = [
  'packages/experimental/agent-team',
  'packages/experimental/agent-team-profile',
  'packages/experimental/agent-team-web-profile',
  'packages/experimental/client-ui-agent-team',
  'packages/experimental/tool-agent-team',
] as const

const publicExperimentalPackageDirectories = new Set<string>(PUBLIC_EXPERIMENTAL_PACKAGE_DIRECTORIES)

/**
 * Whether an experimental package is an explicit public-release exception.
 * @param directory - repository-relative package directory.
 * @returns Whether the package publishes with the dsh family.
 */
export function isPublicExperimentalPackageDirectory(directory: string): boolean {
  return publicExperimentalPackageDirectories.has(directory)
}

/**
 * Existing npm names retained by capabilities now housed under experimental/.
 *
 * Retention is an identity fact, independent of the publication policy above:
 * each entry names the npm package a directory already publishes as.
 */
export const EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS: Readonly<Record<string, string>> = {
  'packages/experimental/tool-session-query': '@deepseek-ai/dsh-tool-session-query',
  'packages/experimental/session-title-all-prompts-llm': '@deepseek-ai/dsh-session-title-all-prompts-llm',
  'packages/experimental/tool-terminal': '@deepseek-ai/dsh-tool-terminal',
  'packages/experimental/tool-ralph': '@deepseek-ai/dsh-tool-ralph',
  'packages/experimental/skill-badge': '@deepseek-ai/dsh-skill-badge',
  'packages/experimental/hook-protocol': '@deepseek-ai/dsh-hook-protocol',
  'packages/experimental/hooks-claude-code': '@deepseek-ai/dsh-hooks-claude-code',
  'packages/experimental/hooks-codex': '@deepseek-ai/dsh-hooks-codex',
  'packages/experimental/webhook': '@deepseek-ai/dsh-webhook',
  'packages/experimental/webhook-github': '@deepseek-ai/dsh-webhook-github',
}

/** npm namespace for experimental packages without retained-name exceptions. */
export const EXPERIMENTAL_PACKAGE_NAME_PREFIX = '@deepseek-ai/dsh-experimental-'

const retainedExperimentalNames = new Set(Object.values(EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS))

/**
 * Identify an experimental npm package independently of its installed directory.
 * @param name - complete npm package name, without a version or subpath.
 * @returns Whether the name uses the experimental prefix or a retained name.
 */
export function isExperimentalPackageName(name: string): boolean {
  return name.startsWith(EXPERIMENTAL_PACKAGE_NAME_PREFIX) || retainedExperimentalNames.has(name)
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
