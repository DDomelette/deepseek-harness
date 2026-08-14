// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AddServerForm, parseKeyValues, SERVER_NAME_PATTERN, splitArgs, validateDraft,
  type AddServerFormProps, type NewServerDraft,
} from '../src/client/AddServerForm.tsx'
import { en, type McpLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: McpLocaleKey): string => en[key])

interface FormProps {
  existingNames?: readonly string[]
  addServer?: (draft: NewServerDraft) => Promise<McpLocaleKey | null>
  onDone?: () => void
  onCancel?: () => void
}

function props(overrides: FormProps = {}): AddServerFormProps {
  return {
    existingNames: [],
    addServer: async () => null,
    onDone: () => {},
    onCancel: () => {},
    t,
    ...overrides,
  }
}

/** A complete stdio submission over the rendered form. */
type AddServer = (draft: NewServerDraft) => Promise<McpLocaleKey | null>
type AddServerMock = ReturnType<typeof vi.fn<AddServer>>

function submitStdio(over: FormProps = {}): { addServer: AddServerMock } {
  const addServer = vi.fn<AddServer>().mockResolvedValue(null)
  render(<AddServerForm {...props({ addServer, ...over })} />)
  fireEvent.change(screen.getByLabelText(en.serverNameLabel), { target: { value: 'memory' } })
  fireEvent.change(screen.getByLabelText(en.commandLabel), { target: { value: 'memorix' } })
  fireEvent.change(screen.getByLabelText(en.argsLabel), { target: { value: 'serve, --verbose' } })
  fireEvent.change(screen.getByLabelText(en.envLabel), { target: { value: 'TOKEN=abc\nFLAG=1' } })
  fireEvent.change(screen.getByLabelText(en.cwdLabel), { target: { value: '/tmp/mem' } })
  fireEvent.change(screen.getByLabelText(en.timeoutLabel), { target: { value: '30000' } })
  return { addServer }
}

describe('AddServerForm', () => {
  it('renders the stdio fields by default and switches transports', () => {
    render(<AddServerForm {...props()} />)
    expect(screen.getByRole('heading', { name: en.addServer })).toBeTruthy()
    expect(screen.getByLabelText(en.serverNameLabel)).toBeTruthy()
    expect(screen.getByLabelText(en.commandLabel)).toBeTruthy()
    expect(screen.getByLabelText(en.argsLabel)).toBeTruthy()
    expect(screen.getByLabelText(en.envLabel)).toBeTruthy()
    expect(screen.getByLabelText(en.cwdLabel)).toBeTruthy()
    expect(screen.getByLabelText(en.timeoutLabel)).toBeTruthy()
    expect(screen.getByRole('radio', { name: en.transportStdio }).getAttribute('aria-checked')).toBe('true')

    fireEvent.click(screen.getByRole('radio', { name: en.transportHttp }))
    expect(screen.queryByLabelText(en.commandLabel)).toBeNull()
    expect(screen.getByLabelText(en.urlLabel)).toBeTruthy()
    expect(screen.getByLabelText(en.headersLabel)).toBeTruthy()
    expect(screen.getByLabelText(en.timeoutLabel)).toBeTruthy()
    expect(screen.getByRole('radio', { name: en.transportHttp }).getAttribute('aria-checked')).toBe('true')
  })

  it('blocks submission with an inline error for an invalid name', async () => {
    const { addServer } = submitStdio()
    fireEvent.change(screen.getByLabelText(en.serverNameLabel), { target: { value: 'bad name' } })
    expect(screen.getByText(en.invalidName)).toBeTruthy()
    const save = screen.getByRole('button', { name: en.save })
    expect(save).toHaveProperty('disabled', true)
    fireEvent.click(save)
    expect(addServer).not.toHaveBeenCalled()
  })

  it('blocks submission for a duplicate name', () => {
    render(<AddServerForm {...props({ existingNames: ['memory'] })} />)
    fireEvent.change(screen.getByLabelText(en.serverNameLabel), { target: { value: 'memory' } })
    fireEvent.change(screen.getByLabelText(en.commandLabel), { target: { value: 'memorix' } })
    expect(screen.getByText(en.duplicateName)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
  })

  it('requires the transport-specific endpoint', () => {
    render(<AddServerForm {...props()} />)
    expect(screen.getByText(en.invalidName)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(en.serverNameLabel), { target: { value: 'memory' } })
    expect(screen.getByText(en.missingCommand)).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: en.transportHttp }))
    expect(screen.getByText(en.missingUrl)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(en.urlLabel), { target: { value: 'http://localhost:3000/mcp' } })
    expect(screen.queryByText(en.missingUrl)).toBeNull()
  })

  it('rejects a non-positive or fractional timeout and a malformed KEY=VALUE line', () => {
    render(<AddServerForm {...props()} />)
    fireEvent.change(screen.getByLabelText(en.serverNameLabel), { target: { value: 'memory' } })
    fireEvent.change(screen.getByLabelText(en.commandLabel), { target: { value: 'memorix' } })
    fireEvent.change(screen.getByLabelText(en.timeoutLabel), { target: { value: '0' } })
    expect(screen.getByText(en.invalidTimeout)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(en.timeoutLabel), { target: { value: '1.5' } })
    expect(screen.getByText(en.invalidTimeout)).toBeTruthy()

    fireEvent.change(screen.getByLabelText(en.timeoutLabel), { target: { value: '60000' } })
    fireEvent.change(screen.getByLabelText(en.envLabel), { target: { value: 'TOKEN=abc\nNO_EQUALS' } })
    expect(screen.getByText(en.invalidKeyValue)).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: en.transportHttp }))
    fireEvent.change(screen.getByLabelText(en.headersLabel), { target: { value: 'NO_EQUALS' } })
    expect(screen.getByText(en.invalidKeyValue)).toBeTruthy()
  })

  it('commits a parsed stdio draft, stays busy in flight, and returns to the roster', async () => {
    const onDone = vi.fn()
    const gate = Promise.withResolvers<McpLocaleKey | null>()
    const addServer = vi.fn<AddServer>(() => gate.promise)
    submitStdio({ onDone, addServer })
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    expect(addServer).toHaveBeenCalledWith({
      serverName: 'memory',
      transport: 'stdio',
      command: 'memorix',
      args: ['serve', '--verbose'],
      env: { TOKEN: 'abc', FLAG: '1' },
      cwd: '/tmp/mem',
      toolCallTimeoutMs: 30000,
    })
    expect(screen.getByRole('button', { name: en.saving })).toHaveProperty('disabled', true)

    await act(async () => { gate.resolve(null) })
    await waitFor(() => { expect(onDone).toHaveBeenCalledOnce() })
  })

  it('commits an http draft with parsed headers and no timeout', async () => {
    const addServer = vi.fn<AddServer>().mockResolvedValue(null)
    render(<AddServerForm {...props({ addServer })} />)
    fireEvent.change(screen.getByLabelText(en.serverNameLabel), { target: { value: 'web' } })
    fireEvent.click(screen.getByRole('radio', { name: en.transportHttp }))
    fireEvent.change(screen.getByLabelText(en.urlLabel), { target: { value: 'http://localhost:3000/mcp' } })
    fireEvent.change(screen.getByLabelText(en.headersLabel), { target: { value: 'Authorization=Bearer t' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    expect(addServer).toHaveBeenCalledWith({
      serverName: 'web',
      transport: 'streamable-http',
      url: 'http://localhost:3000/mcp',
      headers: { Authorization: 'Bearer t' },
    })
  })

  it('keeps the form open and reports a refused save', async () => {
    const onDone = vi.fn()
    submitStdio({ onDone, addServer: async () => 'saveFailed' })
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    expect((await screen.findByText(en.saveFailed)).textContent).toBe(en.saveFailed)
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', false)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('treats a rejecting save like a refused one', async () => {
    const onDone = vi.fn()
    submitStdio({
      onDone,
      addServer: async () => { throw new Error('transport down') },
    })
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    expect((await screen.findByText(en.saveFailed)).textContent).toBe(en.saveFailed)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('cancels back to the roster', () => {
    const onCancel = vi.fn()
    render(<AddServerForm {...props({ onCancel })} />)
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})

describe('AddServerForm pure helpers', () => {
  it('enforces the serverName pattern shared with the settings schema', () => {
    for (const name of ['m', 'a-b_1', 'x'.repeat(32)]) expect(SERVER_NAME_PATTERN.test(name)).toBe(true)
    for (const name of ['', 'has space', '中文', '-'.repeat(33), 'a.b']) expect(SERVER_NAME_PATTERN.test(name)).toBe(false)
  })

  it('splits args on lines and commas, dropping blanks', () => {
    expect(splitArgs('a, b\nc\n\n, d,')).toEqual(['a', 'b', 'c', 'd'])
    expect(splitArgs('')).toEqual([])
  })

  it('parses KEY=VALUE lines and rejects malformed non-empty lines', () => {
    expect(parseKeyValues('TOKEN=abc\n\nFLAG=1\n  SPACED = x  ')).toEqual({
      values: { TOKEN: 'abc', FLAG: '1', SPACED: 'x' },
    })
    expect(parseKeyValues('TOKEN=abc\nNO_EQUALS')).toEqual({ error: 'invalidKeyValue' })
    expect(parseKeyValues('=value')).toEqual({ error: 'invalidKeyValue' })
    expect(parseKeyValues('')).toEqual({ values: {} })
  })

  it('validates a composed draft against names and transport endpoints', () => {
    const stdio: NewServerDraft = {
      serverName: 'm', transport: 'stdio', command: 'x', args: [], env: {}, cwd: '',
    }
    expect(validateDraft(stdio, [])).toBeNull()
    expect(validateDraft({ ...stdio, serverName: 'bad name' }, [])).toBe('invalidName')
    expect(validateDraft(stdio, ['m'])).toBe('duplicateName')
    expect(validateDraft({ ...stdio, command: '  ' }, [])).toBe('missingCommand')
    expect(validateDraft({ ...stdio, toolCallTimeoutMs: 0 }, [])).toBe('invalidTimeout')

    const http: NewServerDraft = {
      serverName: 'h', transport: 'streamable-http', url: 'http://localhost/mcp', headers: {},
    }
    expect(validateDraft(http, [])).toBeNull()
    expect(validateDraft({ ...http, url: '' }, [])).toBe('missingUrl')
  })
})
