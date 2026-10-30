import type { McpServerSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { expect, it, vi } from 'vitest'
import { McpTabController, type McpServersSettings } from '../src/client/mcp-tab-controller.ts'

const empty: McpServerSnapshot = { entries: [] }
const fresh: McpServerSnapshot = {
  entries: [{ serverName: 'filesystem', transport: 'stdio', source: 'settings', enabled: false, status: null }],
}

it.each(['resolve', 'reject'] as const)('keeps the newest roster when an older read later %ss', async (outcome) => {
  const older = Promise.withResolvers<{ ok: true; value: McpServerSnapshot }>()
  const list = vi.fn().mockReturnValueOnce(older.promise).mockResolvedValueOnce({ ok: true, value: fresh })
  const controller = new McpTabController({} as ConfigForm<McpServersSettings>, { list })
  const first = controller.load()
  const second = controller.load()
  try {
    await second
    expect(controller.store.getSnapshot()).toEqual({ status: 'ready', snapshot: fresh })
  } finally {
    if (outcome === 'resolve') older.resolve({ ok: true, value: empty })
    else older.reject(new Error('stale request failed'))
    await first
    controller.dispose()
  }
  expect(controller.store.getSnapshot()).toEqual({ status: 'ready', snapshot: fresh })
})

it.each(['resolve', 'reject'] as const)('ignores a pending read that %ss after disposal', async (outcome) => {
  const response = Promise.withResolvers<{ ok: true; value: McpServerSnapshot }>()
  const list = vi.fn(() => response.promise)
  const controller = new McpTabController({} as ConfigForm<McpServersSettings>, { list })
  const loaded = controller.load()
  const pending = controller.store.getSnapshot()
  controller.dispose()
  if (outcome === 'resolve') response.resolve({ ok: true, value: fresh })
  else response.reject(new Error('late request failed'))
  await loaded
  await controller.load()
  expect(controller.store.getSnapshot()).toBe(pending)
  expect(list).toHaveBeenCalledOnce()
})
