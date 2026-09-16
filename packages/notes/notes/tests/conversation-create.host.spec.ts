/**
 * Starting a notes conversation: the workspace and model come from the settings
 * section, a preset roster (when the deployment has one) joins the new Session,
 * and the record is what the panel later lists and opens.
 */
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bench } from './bench.ts'
import type { Bench } from './bench.ts'
import type { Config } from '../src/settings.ts'

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

describe('notes conversation creation', () => {
  it('starts a Session over the configured workspace and records it as active', async () => {
    const host = await mount()

    const id = await host.sessions.create()

    expect(host.agents.created).toHaveLength(1)
    expect(host.agents.created[0]?.meta).toEqual({ cwd: workspace })
    const stored = host.sessions.get(id)
    expect(stored?.title).toBe('笔记 · 00')
    expect(stored?.archivedAt).toBeNull()
    expect(stored?.sessionId).toBe(host.agents.created[0]?.sessionId)
    expect(host.sessions.active()).toBe(id)
    expect(host.sessions.list().map(row => row.id)).toEqual([id])
  })

  it('numbers each title from the recorded count, so a title is never reused', async () => {
    const host = await mount()

    await host.sessions.create()
    const second = await host.sessions.create()

    expect(host.sessions.get(second)?.title).toBe('笔记 · 01')
  })

  it('titles the Session, so its row is named rather than labelled by the directory', async () => {
    const host = await mount()
    const rename = vi.fn()
    host.ctx.provide('sessionTitle', { rename } as never)

    const id = await host.sessions.create()

    // A session-list row carries the Session's own title and falls back to the
    // workspace directory's name.
    expect(rename).toHaveBeenCalledExactlyOnceWith(host.agents.agents[0]?.session, '笔记 · 00')
    expect(host.sessions.get(id)?.title).toBe('笔记 · 00')
  })

  it('starts the conversation anyway when the title cannot be written', async () => {
    const host = await mount()
    host.ctx.provide('sessionTitle', {
      rename: vi.fn(() => { throw new Error('session is not live') }),
    } as never)

    const id = await host.sessions.create()

    // A name is a convenience: the reader asked for a conversation, and it is
    // recorded whether or not the Session could be titled.
    expect(host.sessions.get(id)?.title).toBe('笔记 · 00')
    expect(host.agents.handles[0]?.disposed).toBe(false)
  })

  it('registers the notes directory as a workspace titled 笔记', async () => {
    const host = await mount()
    const create = vi.fn(async () => ({ attachSession: vi.fn(async () => undefined) }))
    host.ctx.provide('workspaceRegistry', { create } as never)

    await host.sessions.create()

    // The session list groups by workspace, so the directory has to be one; the
    // registry keeps an existing record's title, which is why this only passes
    // one for a record the registry itself creates.
    expect(create).toHaveBeenCalledExactlyOnceWith(workspace, '笔记')
  })

  it('puts the conversation on its workspace account, which is what groups it', async () => {
    const host = await mount()
    const attachSession = vi.fn(async () => undefined)
    host.ctx.provide('workspaceRegistry', {
      create: vi.fn(async () => ({ attachSession })),
    } as never)

    await host.sessions.create()

    // A workspace lists the Sessions it accounts for rather than every Session
    // under its directory, so the record alone leaves the row ungrouped.
    expect(attachSession).toHaveBeenCalledExactlyOnceWith(host.agents.created[0]?.sessionId)
  })

  it('reuses the record a directory already has, and joins each conversation to it', async () => {
    const host = await mount()
    const attachSession = vi.fn(async () => undefined)
    const create = vi.fn(async () => ({ attachSession }))
    host.ctx.provide('workspaceRegistry', { create } as never)

    await host.sessions.create()
    await host.sessions.create()

    // The registry returns the record a path already has, so a directory the
    // reader registered keeps their own name and the plugin adds only
    // membership.
    expect(create).toHaveBeenCalledTimes(2)
    expect(attachSession).toHaveBeenCalledTimes(2)
  })

  it('starts the conversation anyway when the registry cannot own the directory', async () => {
    const host = await mount()
    host.ctx.provide('workspaceRegistry', {
      create: vi.fn(async () => { throw new Error('not a directory') }),
    } as never)

    const id = await host.sessions.create()

    // Grouping is a convenience: the reader asked for a conversation, and it
    // starts with its workspace recorded on the Session either way.
    expect(host.sessions.get(id)?.title).toBe('笔记 · 00')
    expect(host.agents.created[0]?.meta).toEqual({ cwd: workspace })
  })

  it('starts the conversation anyway when the Session cannot join the workspace', async () => {
    const host = await mount()
    host.ctx.provide('workspaceRegistry', {
      create: vi.fn(async () => ({
        attachSession: vi.fn(async () => { throw new Error('cwd does not resolve') }),
      })),
    } as never)

    const id = await host.sessions.create()

    expect(host.sessions.get(id)?.title).toBe('笔记 · 00')
    expect(host.agents.handles[0]?.disposed).toBe(false)
  })

  it('passes the configured model override to the agent', async () => {
    const host = await mount({ model: { provider: 'deepseek', model: 'deepseek-flash' } })

    await host.sessions.create()

    expect(host.agents.created[0]?.agentOptions)
      .toEqual({ provider: 'deepseek', model: 'deepseek-flash' })
  })

  it('follows the deployment default when no model override is configured', async () => {
    const host = await mount()
    host.ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }),
    } as never)

    await host.sessions.create()

    expect(host.agents.created[0]?.agentOptions)
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-flash' })
  })

  it('prefers the configured override over the deployment default', async () => {
    const host = await mount({ model: { provider: 'deepseek', model: 'deepseek-v4-pro' } })
    host.ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }),
    } as never)

    await host.sessions.create()

    expect(host.agents.created[0]?.agentOptions)
      .toEqual({ provider: 'deepseek', model: 'deepseek-v4-pro' })
  })

  it('leaves the route to the request waterfall when the deployment names none', async () => {
    const host = await mount()

    await host.sessions.create()

    expect(host.agents.created[0]).not.toHaveProperty('agentOptions')
  })

  it('joins the default preset when the deployment has a roster', async () => {
    const host = await mount()
    const resolve = vi.fn(async () => ({ id: 'standard' }))
    const mountPreset = vi.fn(async () => ({ id: 'standard' }))
    host.ctx.provide('agentPresets', { resolve, mount: mountPreset } as never)

    await host.sessions.create()

    expect(resolve).toHaveBeenCalledTimes(1)
    expect(host.agents.created[0]?.meta).toEqual({ cwd: workspace, agentPreset: 'standard' })
    // Creation runs the setup callback, which is what mounts the preset into
    // the new Session's own scoped world.
    const setup = host.agents.created[0]?.setup as ((ctx: unknown) => Promise<void>) | undefined
    expect(setup).toBeDefined()
    await setup?.({})
    expect(mountPreset).toHaveBeenCalledWith({}, 'standard')
  })

  it('leaves the preset roster untouched when the deployment has none', async () => {
    const host = await mount()

    await host.sessions.create()

    expect(host.agents.created[0]?.meta).toEqual({ cwd: workspace })
    expect(host.agents.created[0]).not.toHaveProperty('setup')
  })

  it('refuses to create a conversation before a workspace is configured', async () => {
    const host = await mount({ workspace: undefined })

    await expect(host.sessions.create()).rejects.toThrow(/no workspace is configured/)

    expect(host.agents.created).toEqual([])
  })

  it('disposes the created agent when recording fails', async () => {
    const host = await mount()
    vi.spyOn(host.sessions, 'record').mockRejectedValueOnce(new Error('storage refused the write'))

    await expect(host.sessions.create()).rejects.toThrow('storage refused the write')

    // A conversation that never got recorded must not leave its Session running.
    expect(host.agents.handles[0]?.disposed).toBe(true)
    expect(host.sessions.list()).toEqual([])
  })
})
