/**
 * The agent-preset management controller: the roster it reads, the shipped
 * compositions the read-only viewer opens, and the default it writes. Every
 * write re-reads the roster, because the host stays the single fact source.
 */

import { describe, expect, it } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { AgentPresetSectionController } from '../src/client/section-store.ts'

interface FakePreset { content: string; name?: string }
interface Recorded { method: string; payload: unknown }

interface FakeOptions {
  /** Every call the controller made, in order. */
  calls?: Recorded[]
  /** Reject `list` with this message. */
  failList?: string
  /** Reject `read` with this message. */
  failRead?: string
  /** Reject `settings.update` with this message. */
  failSettings?: string
}

const remoteOk = (value: unknown) => Promise.resolve({ ok: true as const, value })
const remoteFail = (message: string) =>
  Promise.resolve({ ok: false as const, error: new RemoteError('gateway/internal', message, {}) })

/**
 * The Remote namespace over an in-memory preset declaration.
 * @param presets - the declarations by id.
 * @param defaultId - the preset a session with no choice gets.
 * @param options - failure injection and call recording.
 * @returns the fake plugin context carrying the Remote namespaces.
 */
function fakeCtx(
  presets: Map<string, FakePreset>,
  defaultId: { id: string },
  options: FakeOptions = {},
): ClientContext {
  const record = (method: string, payload: unknown): void => { options.calls?.push({ method, payload }) }
  return {
    remote: {
      agentPresets: {
        list: () => {
          record('list', {})
          if (options.failList !== undefined) return remoteFail(options.failList)
          return remoteOk({
            presets: [...presets].map(([id, preset]) => ({
              id, isDefault: id === defaultId.id,
              ...preset.name === undefined ? {} : { name: preset.name },
            })),
          })
        },
        read: (agentPreset: string) => {
          record('read', { agentPreset })
          if (options.failRead !== undefined) return remoteFail(options.failRead)
          const preset = presets.get(agentPreset)
          /* v8 ignore next -- every test reads an id the fake store holds */
          if (preset === undefined) return remoteFail(`unknown preset ${agentPreset}`)
          return remoteOk({
            agentPreset,
            content: preset.content,
            ...preset.name === undefined ? {} : { name: preset.name },
          })
        },
      },
      settings: {
        update: (ns: string, patch: { default?: string }) => {
          record('settings.update', { ns, patch })
          if (options.failSettings !== undefined) return remoteFail(options.failSettings)
          /* v8 ignore next -- the controller only ever sets `default` */
          defaultId.id = patch.default ?? defaultId.id
          return remoteOk({})
        },
      },
    },
  } as unknown as ClientContext
}

function seed(): Map<string, FakePreset> {
  return new Map<string, FakePreset>([
    ['standard', { content: '- id: tool-bash\n', name: '标准模式' }],
    ['mine', { content: '- id: tool-read\n' }],
  ])
}

function harness(options: FakeOptions = {}) {
  const presets = seed()
  const defaultId = { id: 'standard' }
  const calls: Recorded[] = []
  const wired = { ...options, calls: options.calls ?? calls }
  const controller = new AgentPresetSectionController(fakeCtx(presets, defaultId, wired))
  return { controller, presets, defaultId, calls }
}

describe('loading the roster', () => {
  it('maps the roster onto rows', async () => {
    const { controller } = harness()

    await controller.load()

    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.rows.map(row => row.id)).toEqual(['standard', 'mine'])
    expect(state.rows[0]).toMatchObject({ isDefault: true, name: '标准模式' })
  })

  it('reports an empty roster as unavailable, not as an error', async () => {
    const { controller, presets } = harness()
    presets.clear()

    await controller.load()

    expect(controller.store.getSnapshot().status).toBe('unavailable')
  })

  it('keeps one load in flight rather than stacking reads', async () => {
    const { controller, calls } = harness()

    await Promise.all([controller.load(), controller.load()])

    expect(calls.filter(call => call.method === 'list')).toHaveLength(1)
  })

  it('surfaces a refusal as the page error', async () => {
    const { controller } = harness({ failList: 'not for you' })

    await controller.load()

    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('not for you')
  })

})

describe('the read-only viewer', () => {
  it('opens a shipped composition under its display name', async () => {
    const { controller } = harness()
    await controller.load()

    await controller.view('standard')

    expect(controller.store.getSnapshot().view).toEqual({
      id: 'standard', title: '标准模式', content: '- id: tool-bash\n',
    })
  })

  it('falls back to the id when the preset published no name', async () => {
    const { controller } = harness()
    await controller.load()

    await controller.view('mine')

    expect(controller.store.getSnapshot().view?.title).toBe('mine')
  })

  it('closes without touching the list', async () => {
    const { controller } = harness()
    await controller.load()
    await controller.view('standard')

    controller.closeView()

    expect(controller.store.getSnapshot().view).toBeNull()
    expect(controller.store.getSnapshot().rows).toHaveLength(2)
  })

  it('puts a read refusal on the page rather than opening empty', async () => {
    const { controller } = harness({ failRead: 'no peeking' })
    await controller.load()

    await controller.view('standard')

    expect(controller.store.getSnapshot().view).toBeNull()
    expect(controller.store.getSnapshot().error).toBe('no peeking')
  })

})

describe('the default preset', () => {
  it('writes the setting and re-reads the roster, keeping the roster readable', async () => {
    const { controller, defaultId, calls } = harness()
    await controller.load()

    await controller.makeDefault('mine')

    expect(defaultId.id).toBe('mine')
    expect(calls.find(call => call.method === 'settings.update')?.payload)
      .toEqual({ ns: 'agent-presets', patch: { default: 'mine' } })
    expect(controller.store.getSnapshot().rows.find(row => row.id === 'mine')?.isDefault).toBe(true)
  })

  it('surfaces a settings refusal as the page error', async () => {
    const { controller } = harness({ failSettings: 'read-only settings' })
    await controller.load()

    await controller.makeDefault('mine')

    expect(controller.store.getSnapshot().error).toContain('read-only settings')
  })
})
