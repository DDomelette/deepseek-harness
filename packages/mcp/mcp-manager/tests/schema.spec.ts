import { describe, expect, it } from 'vitest'
import { MCP_SERVERS_NS, McpServersSchema, SERVER_NAME_PATTERN } from '../src/schema.ts'

describe('mcp-servers schema', () => {
  it('applies stdio defaults', () => {
    const value = McpServersSchema({
      alpha: { transport: 'stdio', command: 'memorix' },
    } as never)
    expect(value.alpha).toMatchObject({
      enabled: true,
      args: [],
      env: {},
      cwd: '',
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    })
  })

  it('applies streamable-http defaults and keeps headers secret-roled', () => {
    const value = McpServersSchema({
      docs: { transport: 'streamable-http', url: 'https://example.com/mcp' },
    } as never)
    expect(value.docs).toMatchObject({ enabled: true, headers: {} })
  })

  it('rejects an entry missing its transport-required field', () => {
    expect(() => McpServersSchema({ broken: { transport: 'stdio' } } as never)).toThrow()
    expect(() => McpServersSchema({ broken: { transport: 'streamable-http' } } as never)).toThrow()
  })

  it('exposes the shared serverName pattern and namespace literal', () => {
    expect(MCP_SERVERS_NS).toBe('mcp-servers')
    expect(SERVER_NAME_PATTERN.test('node_repl')).toBe(true)
    expect(SERVER_NAME_PATTERN.test('has space')).toBe(false)
  })
})
