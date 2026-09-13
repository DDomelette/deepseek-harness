/**
 * Starting a notes conversation: the workspace and model come from the settings
 * section, a preset roster (when the deployment has one) joins the new Session,
 * and the record is what the panel later lists and opens.
 */
import { join, sep } from 'node:path'
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
    expect(stored?.title).toBe('笔记 · notes-workspace 1')
    expect(stored?.archivedAt).toBeNull()
    expect(stored?.sessionId).toBe(host.agents.created[0]?.sessionId)
    expect(host.sessions.active()).toBe(id)
    expect(host.sessions.list().map(row => row.id)).toEqual([id])
  })

  it('numbers each title from the recorded count, so a title is never reused', async () => {
    const host = await mount()

    await host.sessions.create()
    const second = await host.sessions.create()

    expect(host.sessions.get(second)?.title).toBe('笔记 · notes-workspace 2')
  })

  it('falls back to the whole path when the workspace has no name segment', async () => {
    const host = await mount({ workspace: sep })

    const id = await host.sessions.create()

    expect(host.sessions.get(id)?.title).toBe(`笔记 · ${sep} 1`)
  })

  it('passes the configured model override to the agent', async () => {
    const host = await mount({ model: { provider: 'deepseek', model: 'deepseek-flash' } })

    await host.sessions.create()

    expect(host.agents.created[0]?.agentOptions)
      .toEqual({ provider: 'deepseek', model: 'deepseek-flash' })
  })

  it('follows the session default when no model override is configured', async () => {
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
