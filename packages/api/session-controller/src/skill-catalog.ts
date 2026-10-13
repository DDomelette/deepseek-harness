/** Session-addressed, cold-readable skill catalog Remote. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import { isUserInvocable, type SkillSummary } from '@deepseek-ai/dsh-skill'
// Brings the `settings` Context service into this program: the catalog reads
// its namespaces through `ctx.get('settings')`, which is untyped without it.
import type {} from '@deepseek-ai/dsh-settings'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SkillListRequest, SkillListValue, SkillCatalogValue } from './types.ts'

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
  static inject = ['agents', 'sessionQuery', 'typert']

  /** @param ctx - Host context carrying Session reads and optional skill/preset services. */
  constructor(ctx: Context) {
    super(ctx, 'sessionSkillCatalog', { namespace: 'skills' })
  }

  /**
   * List skills available through the Session's slash commands.
   * @param request - Session whose composition selects the catalog.
   * @param signal - caller lifetime.
   * @returns user-invocable metadata without skill bodies.
   */
  @Remote
  async list(request: SkillListRequest, signal: AbortSignal): Promise<SkillListValue> {
    const skills = (await this.readSkills(request, signal)).filter(isUserInvocable)
    return { skills: skills.map(skill => ({
      name: skill.name,
      description: skill.description,
      ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
      modelInvocable: skill.invocation.modelInvocable,
    })) }
  }

  /**
   * List every skill, including disabled entries, for the settings page.
   * @param request - Session whose composition selects the catalog.
   * @param signal - caller lifetime.
   * @returns effective invocation flags, grouping metadata and user overrides.
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
      ...skill.group === undefined ? {} : { group: skill.group },
      source: skill.source,
      modelInvocable: skill.invocation.modelInvocable,
      userInvocable: skill.invocation.userInvocable,
      disabled: disabled.has(skill.name),
    })) }
  }

  private async readSkills(request: SkillListRequest, signal: AbortSignal): Promise<SkillSummary[]> {
    void signal
    const { sessionId } = request
    let cwd: string | undefined
    let agentPreset: string | undefined
    try {
      using observation = await this.ctx.sessionQuery.observeSession(sessionId)
      if (observation.projections === undefined) {
        throw new Error('skill catalog requires a projected Session observation')
      }
      cwd = observation.header.cwd
      agentPreset = observation.projections.values.agentPreset ?? undefined
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
    if (cwd === undefined) {
      throw new RemoteError('gateway/internal', `session "${sessionId}" has no project cwd`, {})
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

  /**
   * Acquire the recorded preset's standing scope without creating an Agent.
   * The lease keeps that composition mounted for the listing, so the caller
   * disposes it once the catalog read settles.
   * @param agentPreset - preset recorded on the Session, when it names one.
   * @returns the scope lease, or undefined when no preset service or preset can serve it.
   */
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
