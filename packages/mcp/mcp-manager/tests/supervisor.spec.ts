import { describe, expect, it } from 'vitest'
import { planServerDiff } from '../src/supervisor.ts'
import type { McpServersSection, McpStdioEntry } from '../src/schema.ts'

const stdio = (over: Partial<McpStdioEntry> = {}): McpStdioEntry => ({
  enabled: true,
  transport: 'stdio',
  command: 'x',
  args: [],
  env: {},
  cwd: '',
  toolCallTimeoutMs: 60_000,
  failOnStartupError: false,
  ...over,
})

describe('planServerDiff', () => {
  it('mounts added enabled entries only', () => {
    const next: McpServersSection = { a: stdio(), b: stdio({ enabled: false }) }
    expect(planServerDiff({}, next)).toEqual([{ kind: 'mount', serverName: 'a' }])
  })

  it('disposes removed or disabled entries', () => {
    const prev: McpServersSection = { a: stdio(), b: stdio() }
    expect(planServerDiff(prev, { a: stdio() })).toEqual([{ kind: 'dispose', serverName: 'b' }])
    expect(planServerDiff(prev, { a: stdio(), b: stdio({ enabled: false }) }))
      .toEqual([{ kind: 'dispose', serverName: 'b' }])
  })

  it('remounts on config change, ignores identical entries', () => {
    const prev: McpServersSection = { a: stdio(), b: stdio() }
    const next: McpServersSection = { a: stdio(), b: stdio({ command: 'y' }) }
    expect(planServerDiff(prev, next)).toEqual([{ kind: 'remount', serverName: 'b' }])
    expect(planServerDiff(prev, { ...prev })).toEqual([])
  })

  it('treats re-enable as mount', () => {
    const prev: McpServersSection = { a: stdio({ enabled: false }) }
    expect(planServerDiff(prev, { a: stdio() })).toEqual([{ kind: 'mount', serverName: 'a' }])
  })

  it('ignores entries disabled in both sections, even when removed', () => {
    const prev: McpServersSection = { a: stdio({ enabled: false }) }
    expect(planServerDiff(prev, {})).toEqual([])
    expect(planServerDiff(prev, { a: stdio({ enabled: false }) })).toEqual([])
  })
})
