/**
 * Resuming a notes conversation: a recorded conversation whose Session this
 * process no longer holds is loaded again on demand, composed the way its
 * creation composed it, and loaded once for callers that arrive together.
 */
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bench, noteSession, sessionId } from './bench.ts'
import type { Bench } from './bench.ts'
import type { Config } from '../src/settings.ts'
import type { NoteSessionId } from '../src/types.ts'

/** The workspace every fixture conversation is created over. */
const workspace = join('probe-root', 'notes-workspace')

let mounted: Bench | undefined

afterEach(async () => {
  if (mounted !== undefined) await mounted.dispose()
  mounted = undefined
})

/**
 * Mount a bench whose composition entry carries a workspace.
 * @param settings - overrides for the composition entry; an omitted key falls
 *   back to the default, and an explicit `undefined` workspace means "none".
 * @returns the mounted bench.
 */
async function mount(settings: {
  readonly strategy?: Config['strategy'] | undefined
  readonly actions?: Config['actions'] | undefined
  readonly workspace?: string | undefined
  readonly model?: Config['model'] | undefined
} = {}): Promise<Bench> {
  // An explicitly supplied `workspace: undefined` means "no workspace
  // configured"; an omitted key keeps the fixture's workspace.
  const cwd = 'workspace' in settings ? settings.workspace : workspace
  mounted = await bench({
    strategy: settings.strategy ?? 'manual',
    actions: settings.actions ?? [],
    ...cwd === undefined ? {} : { workspace: cwd },
    ...settings.model === undefined ? {} : { model: settings.model },
  })
  return mounted
}

/**
 * Record one conversation whose Session this process does not hold, the state
 * a restart leaves behind.
 * @param host - the mounted bench.
 * @param session - the dsh session id the record names.
 * @returns the recorded conversation id.
 */
async function coldConversation(host: Bench, session = 'dsh-cold'): Promise<NoteSessionId> {
  return await host.sessions.record(noteSession({ sessionId: sessionId(session), title: '笔记 · 00' }))
}

describe('notes conversation resume', () => {
  it('returns the agent of a conversation this process still holds, without loading it again', async () => {
    const host = await mount()
    const id = await coldConversation(host, 'dsh-live')
    host.agents.open('dsh-live')

    const agent = await host.sessions.liveAgent(host.sessions.get(id)!)

    expect(agent).toBeDefined()
    expect(host.agents.resumed).toEqual([])
  })

  it('loads the recorded Session again when this process no longer holds it', async () => {
    const host = await mount()
    const id = await coldConversation(host)

    const agent = await host.sessions.liveAgent(host.sessions.get(id)!)

    expect(agent).toBeDefined()
    expect(host.agents.resumed).toEqual([expect.objectContaining({ resumeSessionId: 'dsh-cold' })])
  })

  it('composes a resumed conversation the way its creation composed it', async () => {
    const host = await mount({ model: { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'max' } })
    const resolve = vi.fn(async () => ({ id: 'standard' }))
    const mountPreset = vi.fn(async () => ({ id: 'standard' }))
    host.ctx.provide('agentPresets', { resolve, mount: mountPreset } as never)
    const id = await coldConversation(host)

    await host.sessions.liveAgent(host.sessions.get(id)!)

    // The route and the preset the notes section names are what a conversation
    // created here would get, so a resumed one is not routed differently from
    // the conversation that came before it.
    const request = host.agents.resumed[0]
    expect(request?.agentOptions)
      .toEqual({ provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'max' })
    expect(resolve).toHaveBeenCalledTimes(1)
    const setup = request?.setup as ((ctx: unknown) => Promise<void>) | undefined
    expect(setup).toBeDefined()
    await setup?.({})
    expect(mountPreset).toHaveBeenCalledWith({}, 'standard')
  })

  it('leaves the route and the roster alone when the deployment names neither', async () => {
    const host = await mount()
    const id = await coldConversation(host)

    await host.sessions.liveAgent(host.sessions.get(id)!)

    const request = host.agents.resumed[0]
    expect(request).not.toHaveProperty('agentOptions')
    expect(request).not.toHaveProperty('setup')
  })

  it('loads one conversation once for callers that arrive together', async () => {
    const host = await mount()
    const id = await coldConversation(host)
    const record = host.sessions.get(id)!

    const [first, second] = await Promise.all([
      host.sessions.liveAgent(record),
      host.sessions.liveAgent(record),
    ])

    expect(host.agents.resumed).toHaveLength(1)
    expect(first).toBeDefined()
    expect(second).toBeDefined()
  })

  it('reports nothing when the Session cannot be loaded again', async () => {
    const host = await mount()
    const id = await coldConversation(host)
    host.agents.resumeFailure = new Error('the log is gone')

    await expect(host.sessions.liveAgent(host.sessions.get(id)!)).resolves.toBeUndefined()
    expect(host.agents.resumed).toHaveLength(1)
  })

  it('tries again after a load that failed', async () => {
    const host = await mount()
    const id = await coldConversation(host)
    const record = host.sessions.get(id)!
    host.agents.resumeFailure = new Error('the log is gone')
    await host.sessions.liveAgent(record)

    // A settled failure is not remembered: the reader can retry, and a
    // deployment whose Session came back is served on the next call.
    host.agents.resumeFailure = undefined

    await expect(host.sessions.liveAgent(record)).resolves.toBeDefined()
    expect(host.agents.resumed).toHaveLength(2)
  })
})
