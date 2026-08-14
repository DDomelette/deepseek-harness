// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpServerSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { McpSettingsTab } from '../src/client/McpSettingsTab.tsx'
import type {
  McpSettingsTabInjected,
  McpSettingsTabProps,
} from '../src/client/McpSettingsTab.tsx'
import { McpTabController, type McpServersSettings } from '../src/client/mcp-tab-controller.ts'
import type { NewServerDraft } from '../src/client/AddServerForm.tsx'
import { en, type McpLocaleKey } from '../src/client/locales.ts'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

afterEach(cleanup)

const t = ((key: McpLocaleKey): string => en[key]) as McpSettingsTabProps['t']

function props(injected: McpSettingsTabInjected): McpSettingsTabProps {
  return { t, ...injected } as McpSettingsTabProps
}

const SNAPSHOT: McpServerSnapshot = {
  entries: [
    { serverName: 'filesystem', transport: 'stdio', source: 'settings', enabled: true, status: 'ready' },
    { serverName: 'web-fetch', transport: 'streamable-http', source: 'settings', enabled: true, status: 'connecting' },
    { serverName: 'broken', transport: 'stdio', source: 'settings', enabled: true, status: 'failed', error: 'spawn nope ENOENT' },
    { serverName: 'paused', transport: 'stdio', source: 'settings', enabled: false, status: null },
    { serverName: 'builtin', transport: 'streamable-http', source: 'declarative', enabled: true, status: null },
    { serverName: 'legacy', transport: 'stdio', source: 'declarative', enabled: false, status: null },
  ],
}

function injected(overrides: Partial<McpSettingsTabInjected> = {}): McpSettingsTabInjected {
  return {
    list: async () => SNAPSHOT,
    setEnabled: async () => {},
    addServer: async () => null,
    ...overrides,
  }
}

describe('McpSettingsTab', () => {
  it('renders settings rows with lifecycle status and declarative rows read-only', async () => {
    const deferred = Promise.withResolvers<McpServerSnapshot>()
    const list = vi.fn(() => deferred.promise)
    render(<McpSettingsTab {...props(injected({ list }))} />)
    expect(screen.getByText(en.loading)).toBeTruthy()

    await act(async () => { deferred.resolve(SNAPSHOT) })
    expect(list).toHaveBeenCalledOnce()
    expect(screen.getByRole('searchbox', { name: en.search })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.servers })).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(6)

    // Mount lifecycle only: settled mount reads Running, never Connected.
    expect(screen.getByRole('img', { name: en.ready })).toBeTruthy()
    expect(screen.getByRole('img', { name: en.connecting })).toBeTruthy()
    expect(screen.getByRole('img', { name: en.failed })).toBeTruthy()
    expect(screen.getAllByRole('img')).toHaveLength(3)
    expect(screen.getByText('spawn nope ENOENT')).toBeTruthy()

    // Declarative rows carry the managed-by-config badge and enablement tag, no dot.
    expect(screen.getAllByText(en.declarativeTag)).toHaveLength(2)
    expect(screen.getByText(en.enabledTag)).toBeTruthy()
    expect(screen.getByText(en.disabledTag)).toBeTruthy()
    for (const name of ['builtin', 'legacy']) {
      const toggle = screen.getByRole('switch', { name })
      expect(toggle).toHaveProperty('disabled', true)
      expect(toggle).toHaveProperty('title', en.declarativeTag)
    }
    for (const gear of screen.getAllByRole('button', { name: en.settings })) {
      expect(gear).toHaveProperty('disabled', true)
    }

    // Settings rows keep an enabled switch whose state is the roster enablement.
    const running = screen.getByRole('switch', { name: 'filesystem' })
    expect(running).toHaveProperty('disabled', false)
    expect(running.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'paused' }).getAttribute('aria-checked')).toBe('false')
  })

  it('filters rows by server name case-insensitively', async () => {
    render(<McpSettingsTab {...props(injected())} />)
    const search = await screen.findByRole('searchbox', { name: en.search })

    fireEvent.change(search, { target: { value: '  FILE ' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('filesystem')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'no-such-server' } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(en.emptySearch)).toBeTruthy()
  })

  it('writes enablement through the injected face and refreshes the roster', async () => {
    const flipped: McpServerSnapshot = {
      entries: SNAPSHOT.entries.map(entry => entry.serverName === 'filesystem'
        ? { ...entry, enabled: false, status: null }
        : entry),
    }
    const list = vi.fn<McpSettingsTabInjected['list']>()
      .mockResolvedValueOnce(SNAPSHOT)
      .mockResolvedValueOnce(flipped)
    const write: PromiseWithResolvers<void> = Promise.withResolvers()
    const setEnabled = vi.fn<McpSettingsTabInjected['setEnabled']>(() => write.promise)
    render(<McpSettingsTab {...props(injected({ list, setEnabled }))} />)

    const toggle = await screen.findByRole('switch', { name: 'filesystem' })
    fireEvent.click(toggle)
    expect(setEnabled).toHaveBeenCalledWith('filesystem', false)
    // The switch stays inert until the write and the roster refresh settle.
    expect(screen.getByRole('switch', { name: 'filesystem' })).toHaveProperty('disabled', true)

    await act(async () => { write.resolve() })
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    const updated = await screen.findByRole('switch', { name: 'filesystem' })
    expect(updated.getAttribute('aria-checked')).toBe('false')
    expect(updated).toHaveProperty('disabled', false)
    expect(screen.queryByRole('img', { name: en.ready })).toBeNull()
  })

  it('re-reads the roster even when the write rejects, and reports a failed refresh', async () => {
    const list = vi.fn<McpSettingsTabInjected['list']>()
      .mockResolvedValueOnce(SNAPSHOT)
      .mockResolvedValueOnce(SNAPSHOT)
    const rejected = vi.fn<McpSettingsTabInjected['setEnabled']>().mockRejectedValue(new Error('write refused'))
    const view = render(<McpSettingsTab {...props(injected({ list, setEnabled: rejected }))} />)
    fireEvent.click(await screen.findByRole('switch', { name: 'filesystem' }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(screen.queryByRole('alert')).toBeNull()
    view.unmount()

    const failingRefresh = vi.fn<McpSettingsTabInjected['list']>()
      .mockResolvedValueOnce(SNAPSHOT)
      .mockRejectedValueOnce(new Error('transport down'))
    render(<McpSettingsTab {...props(injected({ list: failingRefresh }))} />)
    fireEvent.click(await screen.findByRole('switch', { name: 'filesystem' }))
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
  })

  it('shows the empty-roster guidance with the add entry and the add form', async () => {
    render(<McpSettingsTab {...props(injected({ list: async () => ({ entries: [] }) }))} />)
    expect(await screen.findByText(en.empty)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.addServer }))
    expect(screen.getByRole('heading', { name: en.addServer })).toBeTruthy()
    expect(screen.getByLabelText(en.serverNameLabel)).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(await screen.findByText(en.empty)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.addServer })).toBeTruthy()
  })

  it('re-reads the roster after an accepted add from a non-empty roster', async () => {
    const list = vi.fn<McpSettingsTabInjected['list']>()
      .mockResolvedValueOnce(SNAPSHOT)
      .mockResolvedValueOnce(SNAPSHOT)
    const addServer = vi.fn<McpSettingsTabInjected['addServer']>().mockResolvedValue(null)
    render(<McpSettingsTab {...props(injected({ list, addServer }))} />)

    fireEvent.click(await screen.findByRole('button', { name: en.addServer }))
    fireEvent.change(screen.getByLabelText(en.serverNameLabel), { target: { value: 'memory' } })
    fireEvent.change(screen.getByLabelText(en.commandLabel), { target: { value: 'memorix' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await screen.findByRole('switch', { name: 'filesystem' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: en.addServer })).toBeNull()
  })

  it('shows a generic failure and retries into the roster', async () => {
    const list = vi.fn<McpSettingsTabInjected['list']>()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValueOnce(SNAPSHOT)
    render(<McpSettingsTab {...props(injected({ list }))} />)

    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    expect(screen.queryByText('private transport detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await screen.findByRole('switch', { name: 'filesystem' })).toBeTruthy()
  })

  it('contains a synchronous Remote failure and ignores a result after unmount', async () => {
    const syncFailure = vi.fn(() => { throw new Error('remote unavailable') }) as McpSettingsTabInjected['list']
    const failed = render(<McpSettingsTab {...props(injected({ list: syncFailure }))} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    failed.unmount()

    const deferred = Promise.withResolvers<McpServerSnapshot>()
    const pending = render(<McpSettingsTab {...props(injected({ list: () => deferred.promise }))} />)
    pending.unmount()
    await act(async () => { deferred.resolve(SNAPSHOT) })

    const deferredFailure = Promise.withResolvers<McpServerSnapshot>()
    const pendingFailure = render(<McpSettingsTab {...props(injected({ list: () => deferredFailure.promise }))} />)
    pendingFailure.unmount()
    await act(async () => { deferredFailure.reject(new Error('late failure')) })
  })
})

describe('McpTabController', () => {
  function scopeStub(value: McpServersSettings | undefined) {
    const snapshot: SettingsScopeSnapshot<McpServersSettings> = {
      status: value === undefined ? 'loading' : 'ready',
      value,
      base: undefined,
      user: undefined,
      revision: 1,
      writable: true,
      mode: 'host',
    }
    const set = vi.fn<SettingsScope<McpServersSettings>['set']>().mockResolvedValue()
    const setPath = vi.fn<SettingsScope<McpServersSettings>['setPath']>().mockResolvedValue()
    const scope: SettingsScope<McpServersSettings> = {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      set,
      setPath,
      unset: async () => {},
    }
    return { scope, set, setPath }
  }

  it('unwraps the Remote envelope and rejects with the wire code', async () => {
    const { scope } = scopeStub({})
    const remote = {
      list: vi.fn()
        .mockResolvedValueOnce({ ok: true, value: SNAPSHOT })
        .mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } }),
    }
    const controller = new McpTabController(scope, remote)
    const face = controller.face()
    await expect(face.list()).resolves.toBe(SNAPSHOT)
    await expect(face.list()).rejects.toThrow('mcpServers.list failed: REMOTE_ERROR: unavailable')
  })

  it('writes only the enablement leaf through a deep path op', async () => {
    const { scope, set, setPath } = scopeStub({ filesystem: { enabled: true, transport: 'stdio' } })
    const controller = new McpTabController(scope, { list: vi.fn() })
    await controller.face().setEnabled('filesystem', false)
    expect(set).not.toHaveBeenCalled()
    expect(setPath).toHaveBeenCalledWith(['filesystem', 'enabled'], false)
  })

  it('no-ops the write while the scope has no accepted entry for the row', async () => {
    const missing = scopeStub(undefined)
    const controller = new McpTabController(missing.scope, { list: vi.fn() })
    await controller.face().setEnabled('filesystem', true)
    expect(missing.setPath).not.toHaveBeenCalled()

    const absent = scopeStub({ other: { enabled: true, transport: 'stdio' } })
    const second = new McpTabController(absent.scope, { list: vi.fn() })
    await second.face().setEnabled('filesystem', true)
    expect(absent.setPath).not.toHaveBeenCalled()
  })

  it('persists a whole new entry and reports acceptance from the scope snapshot', async () => {
    let value: McpServersSettings | undefined
    const set = vi.fn<SettingsScope<McpServersSettings>['set']>(async () => {
      value = { memory: { enabled: true, transport: 'stdio' } }
    })
    const setPath = vi.fn<SettingsScope<McpServersSettings>['setPath']>().mockResolvedValue()
    const scope: SettingsScope<McpServersSettings> = {
      getSnapshot: () => ({
        status: value === undefined ? 'loading' : 'ready',
        value, base: undefined, user: undefined, revision: 1, writable: true, mode: 'host',
      }),
      subscribe: () => () => {},
      set,
      setPath,
      unset: async () => {},
    }
    const draft: NewServerDraft = {
      serverName: 'memory', transport: 'stdio', command: 'memorix',
      args: ['serve'], env: { TOKEN: 'abc' }, cwd: '/tmp/mem', toolCallTimeoutMs: 30_000,
    }
    const controller = new McpTabController(scope, { list: vi.fn() })

    await expect(controller.face().addServer(draft)).resolves.toBeNull()
    expect(set).toHaveBeenCalledWith('memory', {
      transport: 'stdio', command: 'memorix', args: ['serve'], env: { TOKEN: 'abc' }, cwd: '/tmp/mem', toolCallTimeoutMs: 30_000,
    })
  })

  it('reports a refused save while the scope never accepts the entry', async () => {
    const { scope, set } = scopeStub({})
    const controller = new McpTabController(scope, { list: vi.fn() })
    const draft: NewServerDraft = {
      serverName: 'memory', transport: 'streamable-http', url: 'http://localhost/mcp', headers: {},
    }

    await expect(controller.face().addServer(draft)).resolves.toBe('saveFailed')
    expect(set).toHaveBeenCalledOnce()
  })
})
