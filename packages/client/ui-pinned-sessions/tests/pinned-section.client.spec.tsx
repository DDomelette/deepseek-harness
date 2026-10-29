// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { type SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { PendingApproval } from '@deepseek-ai/dsh-client-ui-approval/src/client/contract/slots.ts'
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
  panelActive = false,
  rows = [summary('s1', 1), summary('s2', 2)],
  members = [sid('s1'), sid('s2')],
  archived = [],
  ready = true,
}: {
  pinned?: readonly SessionId[]
  groupOrder?: Readonly<Record<string, readonly SessionId[]>>
  flatOrder?: readonly SessionId[]
  panelActive?: boolean
  rows?: readonly SessionSummary[]
  members?: readonly SessionId[]
  archived?: readonly SessionId[]
  ready?: boolean
} = {}, overrides: Partial<ComponentProps<typeof PinnedSection>> = {}) {
  const sessions = {
    ids: rows.map(row => row.id),
    byId: Object.fromEntries(rows.map(row => [row.id, row])),
    current: sid('s1'),
    phase: 'ready' as const,
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }
  const workspace: WorkspaceView = {
    workspaceId: wid('ws'), path: '/f/ws', title: 'ws', sessionIds: members,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const store = createPinnedSessionsStore().create()
  if (ready) store.actions.commit({ pinnedSessionIds: pinned, groupOrder, flatOrder })
  const open = vi.fn()
  const rename = vi.fn(async () => {})
  const fork = vi.fn()
  const archive = vi.fn(async () => {})
  const setPinned = vi.fn(async () => {})
  const reorderGroup = vi.fn(async () => {})
  const reorderFlat = vi.fn(async () => {})
  const t = (key: string) => key
  render(
    <PinnedSection
      wide
      view="grouped"
      usePanelInfo={selector => selector({ activePanelId: panelActive ? 'test-panel' as MainPanelId : null })}
      useResource={() => { throw new Error('unused by PinnedSection') }}
      useSessionPendingInteraction={selector => selector(new Map())}
      useSessions={selector => selector(sessions)}
      useWorkspaces={selector => selector({
        items: [workspace], archivedSessionIds: archived, archivedSessionAts: {}, state: 'idle', phase: 'ready',
        error: null,
      })}
      useStore={selector => selector(store.getSnapshot())}
      actions={store.actions}
      open={open}
      setPinned={setPinned}
      reorderGroup={reorderGroup}
      reorderFlat={reorderFlat}
      renameSession={rename}
      forkSession={fork}
      archiveSession={archive}
      workspaceT={t}
      t={t}
      {...overrides}
    />,
  )
  return { open, rename, fork, archive, setPinned, reorderGroup, reorderFlat, store }
}

function row(id: string): HTMLElement {
  return screen.getByText(id).closest('[role="treeitem"]') as HTMLElement
}

/** jsdom omits clientY from its DragEvent fallback. */
function dropOn(target: HTMLElement, half: 'before' | 'after'): void {
  target.getBoundingClientRect = () => ({
    top: 100, bottom: 132, left: 0, right: 200, width: 200, height: 32,
    x: 0, y: 100, toJSON: () => ({}),
  })
  for (const kind of ['dragOver', 'drop'] as const) {
    const event = createEvent[kind](target)
    Object.defineProperty(event, 'clientY', { value: half === 'before' ? 105 : 125 })
    fireEvent(target, event)
  }
}

function startDrag(source: HTMLElement): void {
  fireEvent.dragStart(source, { dataTransfer: { effectAllowed: '', setData: vi.fn() } })
}

describe('PinnedSection', () => {
  it.each([
    [{ ready: false }, {}],
    [{ pinned: [] }, {}],
    [{ pinned: [sid('missing')] }, {}],
    [{ archived: [sid('s1'), sid('s2')] }, {}],
    [{}, { wide: false }],
  ])('hides an unavailable or empty pinned list (%j)', (options, overrides) => {
    renderPinned(options, overrides)
    expect(screen.queryByRole('treeitem')).toBeNull()
  })

  it('orders ungrouped and flat pins by recency without a manual override', () => {
    renderPinned({ members: [], pinned: [sid('s1'), sid('missing'), sid('s2'), sid('s1')] })
    expect(screen.getByText('ungrouped')).toBeTruthy()
    expect(screen.getAllByRole('treeitem').map(item => item.querySelector('[class*="title"]')?.textContent)).toEqual(['s2', 's1'])
    cleanup()
    renderPinned({ flatOrder: [] }, { view: 'flat' })
    expect(screen.getAllByRole('treeitem').map(item => item.querySelector('[class*="title"]')?.textContent)).toEqual(['s2', 's1'])
  })

  it('projects pending interaction status and unpins without opening the session', async () => {
    const pending = new PendingApproval(sid('s1'), { toolName: 'shell' })
    try {
      const b = renderPinned({}, {
        useSessionPendingInteraction: selector => selector(new Map([[sid('s1'), pending]])),
      })
      expect(screen.getByText('status.waitingApproval')).toBeTruthy()
      fireEvent.click(row('s1').querySelector('[aria-label="unpin"]')!)
      expect(b.setPinned).toHaveBeenCalledWith(sid('s1'), false, b.store.getSnapshot().snapshot)
      expect(b.open).not.toHaveBeenCalled()
    } finally {
      await pending.answer('rejected')
      await pending.result
    }
  })

  it('ignores self drops, rejects another group, and clears the drag on end', () => {
    const b = renderPinned({ members: [sid('s1')] })
    startDrag(row('s1'))
    dropOn(row('s2'), 'before')
    expect(b.reorderGroup).not.toHaveBeenCalled()
    dropOn(row('s1'), 'after')
    expect(b.reorderGroup).not.toHaveBeenCalled()
    startDrag(row('s1'))
    fireEvent.dragEnd(row('s1'))
    dropOn(row('s1'), 'before')
    expect(b.reorderGroup).not.toHaveBeenCalled()
  })

  it.each([
    ['grouped', 's1', 's3', 'before', ['s2', 's1', 's3']],
    ['grouped', 's3', 's1', 'after', ['s1', 's3', 's2']],
    ['flat', 's1', 's3', 'after', ['s2', 's3', 's1']],
    ['flat', 's3', 's1', 'before', ['s3', 's1', 's2']],
  ] as const)('reorders %s from %s to %s %s', (view, source, target, half, expected) => {
    const ids = ['s1', 's2', 's3'].map(sid)
    const b = renderPinned({
      pinned: ids, members: ids, flatOrder: ids,
      rows: ids.map((id, index) => summary(id, index)),
    }, { view })
    startDrag(row(source))
    dropOn(row(target), half)
    if (view === 'flat') expect(b.reorderFlat).toHaveBeenCalledWith(expected.map(sid), b.store.getSnapshot().snapshot)
    else expect(b.reorderGroup).toHaveBeenCalledWith('ws', expected.map(sid), b.store.getSnapshot().snapshot)
  })

  it.each([false, true])('shows the current session only when the main panel is inactive (panel active: %s)', (panelActive) => {
    renderPinned({ panelActive })
    expect(screen.getByText('s1').closest('[aria-selected]')?.getAttribute('aria-selected')).toBe(String(!panelActive))
  })

  it('keeps the manual group order override instead of re-sorting by account order', () => {
    renderPinned({ groupOrder: { ws: [sid('s2'), sid('s1')] } })
    const titles = screen.getAllByText(/^s[12]$/).map(node => node.textContent)
    expect(titles).toEqual(['s2', 's1'])
  })

  it('follows workspace order while leaving unpinned sessions out of the pinned group', () => {
    renderPinned({
      pinned: [sid('s1'), sid('s3')],
      members: [sid('s3'), sid('s2'), sid('s1')],
      rows: [summary('s1', 3), summary('s2', 2), summary('s3', 1)],
    })
    expect(screen.getAllByRole('treeitem').map(item => item.querySelector('[class*="title"]')?.textContent)).toEqual(['s3', 's1'])
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
