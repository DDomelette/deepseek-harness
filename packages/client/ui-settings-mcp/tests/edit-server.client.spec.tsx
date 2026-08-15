// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EditServerForm, editPatch, type EditServerFormProps, type FormState, type ServerPatch,
} from '../src/client/EditServerForm.tsx'
import type { McpServerSettingsEntry } from '../src/client/mcp-tab-controller.ts'
import { en, type McpLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: McpLocaleKey): string => en[key])

type UpdateServer = (patch: ServerPatch) => Promise<McpLocaleKey | null>
type RemoveServer = () => Promise<McpLocaleKey | null>

interface FormProps {
  serverName?: string
  entry?: McpServerSettingsEntry
  updateServer?: UpdateServer
  removeServer?: RemoveServer
  onDone?: () => void
  onCancel?: () => void
}

/** Read an input/textarea's staged value from an HTMLElement query result. */
function valueOf(el: HTMLElement): string {
  return (el as HTMLInputElement | HTMLTextAreaElement).value
}

/** Read an input/textarea's placeholder from an HTMLElement query result. */
function placeholderOf(el: HTMLElement): string {
  return (el as HTMLInputElement | HTMLTextAreaElement).placeholder
}

const STDIO_ENTRY: McpServerSettingsEntry = {
  enabled: true,
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'serve'],
  cwd: '/tmp/mem',
  toolCallTimeoutMs: 30_000,
  reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
}

const HTTP_ENTRY: McpServerSettingsEntry = {
  enabled: true,
  transport: 'streamable-http',
  url: 'http://localhost:3000/mcp',
  toolCallTimeoutMs: 60_000,
  reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
}

function props(overrides: FormProps = {}): EditServerFormProps {
  return {
    serverName: 'memory',
    entry: STDIO_ENTRY,
    updateServer: async () => null,
    removeServer: async () => null,
    onDone: () => {},
    onCancel: () => {},
    t,
    ...overrides,
  }
}

describe('EditServerForm', () => {
  it('prefills the non-secret fields and masks the stored env', () => {
    render(<EditServerForm {...props()} />)
    expect(screen.getByText('memory')).toBeTruthy()
    expect(valueOf(screen.getByLabelText(en.commandLabel))).toBe('npx')
    expect(valueOf(screen.getByLabelText(en.argsLabel))).toBe('-y\nserve')
    expect(valueOf(screen.getByLabelText(en.cwdLabel))).toBe('/tmp/mem')
    expect(valueOf(screen.getByLabelText(en.timeoutLabel))).toBe('30000')
    const env = screen.getByLabelText(en.envLabel)
    expect(valueOf(env)).toBe('')
    expect(placeholderOf(env)).toBe(en.keepSecretHint)
  })

  it('prefills the http fields and masks the stored headers', () => {
    render(<EditServerForm {...props({ entry: HTTP_ENTRY })} />)
    expect(valueOf(screen.getByLabelText(en.urlLabel))).toBe('http://localhost:3000/mcp')
    expect(valueOf(screen.getByLabelText(en.timeoutLabel))).toBe('60000')
    const headers = screen.getByLabelText(en.headersLabel)
    expect(valueOf(headers)).toBe('')
    expect(placeholderOf(headers)).toBe(en.keepSecretHint)
    expect(screen.queryByLabelText(en.commandLabel)).toBeNull()
  })

  it('commits only the changed fields, leaving blank secrets untouched', async () => {
    const updateServer = vi.fn<UpdateServer>().mockResolvedValue(null)
    const onDone = vi.fn()
    render(<EditServerForm {...props({ updateServer, onDone })} />)

    fireEvent.change(screen.getByLabelText(en.commandLabel), { target: { value: 'memorix' } })
    fireEvent.change(screen.getByLabelText(en.timeoutLabel), { target: { value: '45000' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => { expect(onDone).toHaveBeenCalledOnce() })
    expect(updateServer).toHaveBeenCalledWith({ command: 'memorix', toolCallTimeoutMs: 45_000 })
  })

  it('prefills and updates the reconnect policy as one complete block', async () => {
    const updateServer = vi.fn<UpdateServer>().mockResolvedValue(null)
    render(<EditServerForm {...props({ updateServer })} />)

    expect(screen.getByRole('checkbox', { name: en.reconnectEnabledLabel })).toHaveProperty('checked', true)
    expect(valueOf(screen.getByLabelText(en.reconnectMaxAttemptsLabel))).toBe('10')
    fireEvent.click(screen.getByRole('checkbox', { name: en.reconnectEnabledLabel }))
    fireEvent.change(screen.getByLabelText(en.reconnectMaxAttemptsLabel), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => {
      expect(updateServer).toHaveBeenCalledWith({
        reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 3 },
      })
    })
  })

  it('includes a typed env dict and nothing else', async () => {
    const updateServer = vi.fn<UpdateServer>().mockResolvedValue(null)
    render(<EditServerForm {...props({ updateServer })} />)

    fireEvent.change(screen.getByLabelText(en.envLabel), { target: { value: 'TOKEN=abc' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => { expect(updateServer).toHaveBeenCalledWith({ env: { TOKEN: 'abc' } }) })
  })

  it('validates the effective entry and blocks invalid submissions', () => {
    render(<EditServerForm {...props()} />)
    fireEvent.change(screen.getByLabelText(en.commandLabel), { target: { value: '   ' } })
    expect(screen.getByText(en.missingCommand)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)

    fireEvent.change(screen.getByLabelText(en.commandLabel), { target: { value: 'memorix' } })
    fireEvent.change(screen.getByLabelText(en.timeoutLabel), { target: { value: '0' } })
    expect(screen.getByText(en.invalidTimeout)).toBeTruthy()

    fireEvent.change(screen.getByLabelText(en.timeoutLabel), { target: { value: '45000' } })
    fireEvent.change(screen.getByLabelText(en.envLabel), { target: { value: 'NO_EQUALS' } })
    expect(screen.getByText(en.invalidKeyValue)).toBeTruthy()
  })

  it('stays busy in flight and reports a refused save', async () => {
    const gate = Promise.withResolvers<McpLocaleKey | null>()
    const updateServer = vi.fn<UpdateServer>(() => gate.promise)
    const onDone = vi.fn()
    render(<EditServerForm {...props({ updateServer, onDone })} />)

    fireEvent.change(screen.getByLabelText(en.commandLabel), { target: { value: 'memorix' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(screen.getByRole('button', { name: en.saving })).toHaveProperty('disabled', true)

    await act(async () => { gate.resolve('saveFailed') })
    expect((await screen.findByText(en.saveFailed)).textContent).toBe(en.saveFailed)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('asks for confirmation before removing and cancels cleanly', async () => {
    const removeServer = vi.fn<RemoveServer>().mockResolvedValue(null)
    const onDone = vi.fn()
    render(<EditServerForm {...props({ removeServer, onDone })} />)

    fireEvent.click(screen.getByRole('button', { name: en.delete }))
    expect(screen.getByRole('button', { name: en.deleteConfirm })).toBeTruthy()
    expect(removeServer).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(removeServer).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: en.deleteConfirm })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.delete }))
    fireEvent.click(screen.getByRole('button', { name: en.deleteConfirm }))
    await waitFor(() => { expect(removeServer).toHaveBeenCalledOnce() })
    await waitFor(() => { expect(onDone).toHaveBeenCalledOnce() })
  })

  it('cancels the whole edit view', () => {
    const onCancel = vi.fn()
    render(<EditServerForm {...props({ onCancel })} />)
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('prefills blanks from a sparse entry', () => {
    render(<EditServerForm {...props({ entry: { enabled: true, transport: 'stdio' } })} />)
    expect(valueOf(screen.getByLabelText(en.commandLabel))).toBe('')
    expect(valueOf(screen.getByLabelText(en.argsLabel))).toBe('')
    expect(valueOf(screen.getByLabelText(en.cwdLabel))).toBe('')
    expect(valueOf(screen.getByLabelText(en.timeoutLabel))).toBe('')
  })

  it('reports a rejecting save like a refused one', async () => {
    const onDone = vi.fn()
    const updateServer = vi.fn<UpdateServer>(async () => { throw new Error('transport down') })
    render(<EditServerForm {...props({ updateServer, onDone })} />)

    fireEvent.change(screen.getByLabelText(en.commandLabel), { target: { value: 'memorix' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    expect((await screen.findByText(en.saveFailed)).textContent).toBe(en.saveFailed)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('reports a rejecting remove and stays in the confirm state', async () => {
    const removeServer = vi.fn<RemoveServer>(async () => { throw new Error('transport down') })
    render(<EditServerForm {...props({ removeServer })} />)

    fireEvent.click(screen.getByRole('button', { name: en.delete }))
    fireEvent.click(screen.getByRole('button', { name: en.deleteConfirm }))

    expect((await screen.findByText(en.saveFailed)).textContent).toBe(en.saveFailed)
    expect(screen.getByRole('button', { name: en.deleteConfirm })).toBeTruthy()
  })

  it('reports a refused remove and stays in the confirm state', async () => {
    const onDone = vi.fn()
    const removeServer = vi.fn<RemoveServer>().mockResolvedValue('saveFailed')
    render(<EditServerForm {...props({ removeServer, onDone })} />)

    fireEvent.click(screen.getByRole('button', { name: en.delete }))
    fireEvent.click(screen.getByRole('button', { name: en.deleteConfirm }))

    expect((await screen.findByText(en.saveFailed)).textContent).toBe(en.saveFailed)
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: en.deleteConfirm })).toBeTruthy()
  })
})

describe('editPatch', () => {
  const stdio = (state: Partial<FormState> = {}): FormState => ({
    command: 'npx',
    args: '-y\nserve',
    env: '',
    cwd: '/tmp/mem',
    url: '',
    headers: '',
    timeout: '30000',
    reconnect: { enabled: true, initialDelayMs: '500', maxDelayMs: '30000', maxAttempts: '10' },
    ...state,
  })

  it('names only the moved fields for a stdio entry', () => {
    const result = editPatch(STDIO_ENTRY, 'memory', stdio({ args: '-y\nother', cwd: '/new', timeout: '' }))
    expect(result).toEqual({ patch: { args: ['-y', 'other'], cwd: '/new' } })
  })

  it('builds an http patch from changed url, headers, and timeout', () => {
    const result = editPatch(HTTP_ENTRY, 'web', {
      command: '', args: '', env: '', cwd: '', url: 'http://localhost:4000/mcp', headers: 'A=B', timeout: '90000',
      reconnect: { enabled: true, initialDelayMs: '500', maxDelayMs: '30000', maxAttempts: '10' },
    })
    expect(result).toEqual({ patch: { url: 'http://localhost:4000/mcp', headers: { A: 'B' }, toolCallTimeoutMs: 90_000 } })
  })

  it('does not treat reconnect property order as a policy change', () => {
    const reordered: McpServerSettingsEntry = {
      ...HTTP_ENTRY,
      reconnect: { maxAttempts: 10, maxDelayMs: 30_000, initialDelayMs: 500, enabled: true },
    }
    const result = editPatch(reordered, 'web', {
      command: '', args: '', env: '', cwd: '', url: 'http://localhost:3000/mcp', headers: '', timeout: '60000',
      reconnect: { enabled: true, initialDelayMs: '500', maxDelayMs: '30000', maxAttempts: '10' },
    })
    expect(result).toEqual({ patch: {} })
  })

  it('rejects an invalid reconnect policy while editing', () => {
    const result = editPatch(HTTP_ENTRY, 'web', {
      command: '', args: '', env: '', cwd: '', url: 'http://localhost:3000/mcp', headers: '', timeout: '60000',
      reconnect: { enabled: true, initialDelayMs: '30001', maxDelayMs: '30000', maxAttempts: '10' },
    })
    expect(result).toEqual({ error: 'invalidReconnect' })
  })

  it('rejects a malformed typed header line', () => {
    const result = editPatch(HTTP_ENTRY, 'web', {
      command: '', args: '', env: '', cwd: '', url: 'http://localhost:3000/mcp', headers: 'NO_EQUALS', timeout: '60000',
      reconnect: { enabled: true, initialDelayMs: '500', maxDelayMs: '30000', maxAttempts: '10' },
    })
    expect(result).toEqual({ error: 'invalidKeyValue' })
  })

  it('produces an empty patch for an untouched sparse http entry', () => {
    const sparse: McpServerSettingsEntry = { enabled: true, transport: 'streamable-http', url: 'http://localhost:3000/mcp' }
    const result = editPatch(sparse, 'web', {
      command: '', args: '', env: '', cwd: '', url: 'http://localhost:3000/mcp', headers: '', timeout: '',
      reconnect: { enabled: true, initialDelayMs: '500', maxDelayMs: '30000', maxAttempts: '10' },
    })
    expect(result).toEqual({ patch: {} })
  })
})
