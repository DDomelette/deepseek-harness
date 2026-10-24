/** Session-addressed, cold-readable skill catalog Remote. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
// Brings the `settings` Context service into this program: the catalog reads
// its namespace through `ctx.get('settings')`, which is untyped without it.
import type {} from '@deepseek-ai/dsh-settings'
import { isUserInvocable, type SkillSummary } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-working-directory'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SkillCatalogValue, SkillListRequest, SkillListValue } from './types.ts'

/** Settings namespace of the skill-settings entry, whose live `disabled` list is the user's switch-off roster. */
const SKILL_SETTINGS_NAMESPACE = 'skill-settings'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the Session-addressed `skills` Remote namespace. */
    sessionSkillCatalog: SessionSkillCatalog
  }
}

/** Host service backing `ctx.remote.skills` without activating a cold Agent. */
export class SessionSkillCatalog extends TypertRemoteService {
  static inject = ['agents', 'sessionQuery', 'typert', 'workingDirectory']

  /** @param ctx - Host context carrying Session reads and optional skill/preset services. */
  constructor(ctx: Context) {
    super(ctx, 'sessionSkillCatalog', { namespace: 'skills' })
  }

  /**
   * List the user-invocable skills visible to one Session composition.
   * @param request - Session identity whose cwd and preset select the catalog view.
   * @param signal - caller lifetime carried by the Remote transport; admitted catalog reads retain their existing completion semantics.
   * @returns user-invocable skill metadata without loading skill bodies.
   * @throws RemoteError when the Session cannot be inspected or no registry can serve it.
   */
  @Remote
  async list(request: SkillListRequest, signal: AbortSignal): Promise<SkillListValue> {
    const skills = (await this.readSkills(request, signal)).filter(isUserInvocable)
    return { skills: skills.map(skill => ({
      name: skill.name,
      ...skill.path === undefined ? {} : { path: skill.path },
      description: skill.description,
      ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
      modelInvocable: skill.invocation.modelInvocable,
    })) }
  }

  /**
   * List every skill, including switch-off entries, for the settings panel.
   * @param request - Session identity whose cwd and preset select the catalog view.
   * @param signal - caller lifetime carried by the Remote transport.
   * @returns every visible skill with its effective invocation flags and user-override state.
   * @throws RemoteError when the Session cannot be inspected or no registry can serve it.
   */
  @Remote
  async catalog(request: SkillListRequest, signal: AbortSignal): Promise<SkillCatalogValue> {
    const skills = await this.readSkills(request, signal)
    const section = this.ctx.get('settings')?.describe()
      .find(view => view.ns === SKILL_SETTINGS_NAMESPACE)?.value as { disabled?: readonly string[] } | undefined
    const disabled = new Set(section?.disabled ?? [])
    return { skills: skills.map(skill => ({
      name: skill.name,
      description: skill.description,
      ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
      source: skill.source,
      modelInvocable: skill.invocation.modelInvocable,
      userInvocable: skill.invocation.userInvocable,
      disabled: disabled.has(skill.name),
    })) }
  }

  /** Resolve the skills one Session composition can reach without activating a cold Agent. */
  private async readSkills(request: SkillListRequest, signal: AbortSignal): Promise<SkillSummary[]> {
    const { sessionId } = request
    let cwd: string
    let agentPreset: string | undefined
    try {
      using observation = await this.ctx.sessionQuery.observeSession(sessionId)
      if (observation.projections === undefined) {
        throw new Error('skill catalog requires a projected Session observation')
      }
      cwd = observation.projections.values.workingDirectory
        ?? observation.header.cwd
        ?? this.ctx.workingDirectory.defaultDirectory
      agentPreset = observation.projections.values.agentPreset ?? undefined
      const live = this.ctx.agents.get(sessionId)
      if (live !== undefined) cwd = await this.ctx.workingDirectory.ensure(live, signal)
    } catch (error: unknown) {
      if (error instanceof SessionQueryError
        && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        throw new RemoteError('session/not-found', `session "${sessionId}" not found`, { sessionId })
      }
      throw new RemoteError(
        'gateway/internal',
        `session "${sessionId}" could not be inspected: ${String(error)}`,
        {},
      )
    }

    const live = this.ctx.agents.get(sessionId)
    const presets = this.ctx.get('agentPresets')
    const scoped = live === undefined ? undefined : presets?.serviceFor(live, 'skills')
    const skillRegistry = scoped ?? this.ctx.get('skills')
    if (skillRegistry === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'skill registry is absent: neither this session\'s agent preset nor the host composition mounts @deepseek-ai/dsh-skill',
        {},
      )
    }

    await using lease = live === undefined ? await this.scopeFor(agentPreset) : undefined
    const scope = live ?? lease?.key
    try {
      return await skillRegistry.list({ cwd, scope })
    } catch (error: unknown) {
      throw new RemoteError('gateway/internal', `skill listing failed: ${String(error)}`, {})
    }
  }

  /** Resolve a live or standing preset scope without creating an Agent. */
  private async scopeFor(
    agentPreset: string | undefined,
  ): Promise<({ key: ScopeKey } & AsyncDisposable) | undefined> {
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return undefined
    try {
      return await presets.acquireScope(agentPreset)
    } catch {
      // An unknown or unusable recorded preset falls back to the global registry.
      return undefined
    }
  }
}

export default SessionSkillCatalog
