/**
 * The skills settings-panel domain: `skill.catalog` serves the complete
 * invocation-neutral catalog for configuration surfaces — every skill the
 * addressed session's composition resolves, regardless of invocation policy,
 * with grouping metadata and the user-disabled flag — while `skill.list`
 * keeps serving the composer menu.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as SkillSettings from '@deepseek-ai/dsh-skill-settings'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { RpcId, type RpcRequest } from '../src/api/rpc.ts'
import { createApiProxy } from '../src/api-proxy.ts'

let nextRpc = 0
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`skills-${String(nextRpc++)}`), payload }
}

/** A provider implementing only the three primitives: the Service Definition owns initialization. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown>

  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], options?: { doc?: Record<string, unknown> }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
  }

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

describe('skill.catalog', () => {
  it('serves every skill of the addressed session with grouping metadata, effective invocation flags, and the disabled flag', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SkillRegistry)
    ctx.skills.register({ name: 'grouped-a', description: 'Grouped A', source: 'user-dsh', group: 'superpowers', content: 'A.' })
    ctx.skills.register({ name: 'solo-b', description: 'Solo B', source: 'user-dsh', content: 'B.' })
    ctx.skills.register({
      name: 'user-only-c',
      description: 'User only C',
      source: 'project-agents',
      invocation: { modelInvocable: false, userInvocable: true },
      content: 'C.',
    })
    await ctx.plugin(MemorySettings, { doc: { skills: { disabled: ['grouped-a'] } } })
    await ctx.plugin(SkillSettings)
    const sessionId = SessionId('sk-catalog-1')
    ctx.sessions.create(sessionId, { meta: { cwd: process.cwd() } })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
      cwd: process.cwd(),
    })

    const response = await api.skills.catalog(request({ sessionId }))

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    expect(response.result.value.skills).toEqual([
      {
        name: 'grouped-a',
        description: 'Grouped A',
        group: 'superpowers',
        source: 'user-dsh',
        modelInvocable: false,
        userInvocable: false,
        disabled: true,
      },
      {
        name: 'solo-b',
        description: 'Solo B',
        source: 'user-dsh',
        modelInvocable: true,
        userInvocable: true,
        disabled: false,
      },
      {
        name: 'user-only-c',
        description: 'User only C',
        source: 'project-agents',
        modelInvocable: false,
        userInvocable: true,
        disabled: false,
      },
    ])
  })

  it('rejects an unknown session before touching the registry', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(MemorySettings)
    await ctx.plugin(SkillSettings)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
      cwd: process.cwd(),
    })

    const response = await api.skills.catalog(request({ sessionId: SessionId('sk-unknown') }))

    expect(response.result).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
  })

  it('reports the registry absence as an internal error', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(MemorySettings)
    await ctx.plugin(SkillSettings)
    const sessionId = SessionId('sk-catalog-3')
    ctx.sessions.create(sessionId, { meta: { cwd: process.cwd() } })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
      cwd: process.cwd(),
    })

    const response = await api.skills.catalog(request({ sessionId }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('internal')
    expect(response.result.error.message).toContain('skill registry is absent')
  })
})
