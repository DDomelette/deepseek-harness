// @vitest-environment jsdom
/** Archived settings section: grouping, restore action, delete confirmation. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { ArchivedSection, type ArchivedSectionInjected } from '../src/client/ArchivedSection.tsx'
import { zh, type ArchivedSettingsKey } from '../src/client/locales.ts'

const sid = (id: string): SessionId => id as SessionId
const wid = (id: string): WorkspaceId => id as WorkspaceId

const t: TranslateNS<'settings.archived'> = (key): string =>
  key in zh ? zh[key as ArchivedSettingsKey] : key

const sessionsState = (): SessionListState => ({
  ids: [sid('a1'), sid('a2'), sid('loose')],
  byId: {
    [sid('a1')]: {
      id: sid('a1'), displayTitle: 'alpha-1', updatedAt: 3, running: false, blank: false, parentId: undefined,
    },
    [sid('a2')]: {
      id: sid('a2'), displayTitle: 'alpha-2', updatedAt: 2, running: false, blank: false, parentId: undefined,
    },
    [sid('loose')]: {
      id: sid('loose'), displayTitle: 'loose', updatedAt: 1, running: false, blank: false, parentId: undefined,
    },
  } as unknown as SessionListState['byId'],
  current: undefined,
  phase: 'ready',
  subagentsByParent: {},
  jobsBySession: {},
  currentAddress: undefined,
})

const workspacesState = (): WorkspaceListState => ({
  items: [{
    workspaceId: wid('ws-a'),
    path: '/w/alpha',
    title: 'alpha',
    sessionIds: [sid('a2'), sid('a1')],
    createdAt: '0',
    updatedAt: '0',
  }],
  archivedSessionIds: [sid('a1'), sid('a2'), sid('loose')],
  state: 'idle',
  phase: 'ready',
  error: null,
  baselinesReady: true,
  recentWorkspaceId: undefined,
})

const useSessions = <S,>(selector: (state: SessionListState) => S): S => selector(sessionsState())
const useWorkspaces = <S,>(selector: (state: WorkspaceListState) => S): S => selector(workspacesState())

function mount(
  injected: ArchivedSectionInjected = {
    restore: vi.fn(async () => true),
    deleteSession: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
  },
): ArchivedSectionInjected {
  render(<ArchivedSection
    useSessions={useSessions}
    useWorkspaces={useWorkspaces}
    close={vi.fn()}
    t={t}
    restore={id => injected.restore(id)}
    deleteSession={id => injected.deleteSession(id)}
    refresh={() => injected.refresh()}
  />)
  return injected
}

afterEach(cleanup)

describe('ArchivedSection', () => {
  it('renders workspace groups and the Ungrouped group last', () => {
    mount()
    const headings = screen.getAllByRole('heading', { level: 3 })
    expect(headings.map(heading => heading.textContent)).toEqual([
      expect.stringContaining('alpha'),
      expect.stringContaining('未分组'),
    ])
    expect(screen.getByText('alpha-2')).toBeTruthy()
    expect(screen.getByText('alpha-1')).toBeTruthy()
    expect(screen.getByText('loose')).toBeTruthy()
  })

  it('restores a row and closes settings when restore reports opened', async () => {
    const restore = vi.fn(async () => true)
    const close = vi.fn()
    render(<ArchivedSection
      useSessions={useSessions}
      useWorkspaces={useWorkspaces}
      close={close}
      t={t}
      restore={restore}
      deleteSession={vi.fn(async () => {})}
      refresh={vi.fn(async () => {})}
    />)
    fireEvent.click(screen.getByRole('button', { name: '恢复对话 alpha-1' }))
    await waitFor(() => { expect(restore).toHaveBeenCalledWith(sid('a1')) })
    expect(close).toHaveBeenCalledOnce()
  })

  it('opens the delete confirmation with descendant count and confirms', async () => {
    const deleteSession = vi.fn(async () => {})
    mount({ restore: vi.fn(async () => true), deleteSession, refresh: vi.fn(async () => {}) })
    fireEvent.click(screen.getByRole('button', { name: '删除对话 alpha-1' }))
    expect(screen.getByRole('dialog', { name: '删除对话？' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => { expect(deleteSession).toHaveBeenCalledWith(sid('a1')) })
    expect(screen.queryByRole('dialog', { name: '删除对话？' })).toBeNull()
  })

  it('disables delete for a running archived row', () => {
    const original = sessionsState()
    original.byId[sid('loose')] = { ...original.byId[sid('loose')]!, running: true }
    const runningSessions = <S,>(selector: (state: SessionListState) => S): S => selector(original)
    render(<ArchivedSection
      useSessions={runningSessions}
      useWorkspaces={useWorkspaces}
      close={vi.fn()}
      t={t}
      restore={vi.fn(async () => true)}
      deleteSession={vi.fn(async () => {})}
      refresh={vi.fn(async () => {})}
    />)
    expect(screen.getByRole('button', { name: '删除对话 loose' })).toHaveProperty('disabled', true)
  })
})
