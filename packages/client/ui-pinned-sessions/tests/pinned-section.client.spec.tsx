// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { PinnedSection } from '../src/client/PinnedSection.tsx'
import { createPinnedSessionsStore } from '../src/client/stores.ts'

afterEach(cleanup)

const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId

function summary(id: string, updatedAt: number): SessionSummary {
  return { id: sid(id), displayTitle: id, running: false, blank: false, updatedAt }
}

function renderPinned({
  pinned = [sid('s1'), sid('s2')],
  groupOrder = {},
  flatOrder = [],
}: {
  pinned?: readonly SessionId[]
  groupOrder?: Readonly<Record<string, readonly SessionId[]>>
  flatOrder?: readonly SessionId[]
} = {}) {
  const sessions = {
    ids: [sid('s1'), sid('s2')],
    byId: { [sid('s1')]: summary('s1', 1), [sid('s2')]: summary('s2', 2) },
    current: undefined,
    phase: 'ready' as const,
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }
  const workspace: WorkspaceView = {
    workspaceId: wid('ws'), path: '/f/ws', title: 'ws', sessionIds: [sid('s1'), sid('s2')],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const store = createPinnedSessionsStore().create()
  store.actions.commit({ pinnedSessionIds: pinned, groupOrder, flatOrder })
  const open = vi.fn()
  const rename = vi.fn(async () => {})
  const fork = vi.fn()
  const archive = vi.fn(async () => {})
  const t = (key: string) => key
  render(
    <PinnedSection
      wide
      view="grouped"
      useSessions={selector => selector(sessions)}
      useWorkspaces={selector => selector({
        items: [workspace], archivedSessionIds: [], archivedSessionAts: {}, sessionFlags: {}, state: 'idle', phase: 'ready',
        error: null, baselinesReady: true, recentWorkspaceId: undefined,
      })}
      useStore={selector => selector(store.getSnapshot())}
      actions={store.actions}
      open={open}
      setPinned={vi.fn(async () => {})}
      reorderGroup={vi.fn(async () => {})}
      reorderFlat={vi.fn(async () => {})}
      renameSession={rename}
      forkSession={fork}
      archiveSession={archive}
      workspaceT={t}
      t={t}
    />,
  )
  return { open, rename, fork, archive }
}

describe('PinnedSection', () => {
  it('keeps the manual group order override instead of re-sorting by account order', () => {
    renderPinned({ groupOrder: { ws: [sid('s2'), sid('s1')] } })
    const titles = screen.getAllByText(/^s[12]$/).map(node => node.textContent)
    expect(titles).toEqual(['s2', 's1'])
  })

  it('renders the full session row menu and dispatches rename, fork, and archive', () => {
    const { rename, fork, archive } = renderPinned()
    fireEvent.click(screen.getAllByRole('button', { name: 'actions.session.aria' })[0]!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'rename' }))
    expect(rename).toHaveBeenCalledWith(sid('s1'), 's1')
    fireEvent.click(screen.getAllByRole('button', { name: 'actions.session.aria' })[0]!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'menu.fork' }))
    expect(fork).toHaveBeenCalledWith(sid('s1'))
    fireEvent.click(screen.getAllByRole('button', { name: 'actions.session.aria' })[0]!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'menu.archiveSession' }))
    expect(archive).toHaveBeenCalledWith(sid('s1'))
  })
})
