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

const t: TranslateNS<'settings.archived'> = (key, params): string => {
  const template = key in zh ? zh[key as ArchivedSettingsKey] : key
  return Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  )
}

const sessionsState = (): SessionListState => ({
  ids: [sid('a1'), sid('a2'), sid('loose')],
  byId: {
    [sid('a1')]: {
      id: sid('a1'), displayTitle: 'alpha-1', updatedAt: Date.parse('2026-08-19T01:00:00.000Z'),
      running: false, blank: false, cwd: '/w/alpha', agentPreset: 'default',
    },
    [sid('a2')]: {
      id: sid('a2'), displayTitle: 'alpha-2', updatedAt: Date.parse('2026-08-18T01:00:00.000Z'),
      running: false, blank: false,
    },
    [sid('loose')]: {
      id: sid('loose'), displayTitle: 'loose', updatedAt: 0, running: false, blank: false,
    },
  },
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
  archivedSessionAts: {
    [sid('a1')]: '2026-08-20T10:30:00.000Z',
    // A corrupt durable value still renders, as the language-neutral dash.
    [sid('loose')]: 'not-a-date',
  },
  state: 'idle',
  phase: 'ready',
  error: null,
  baselinesReady: true,
  recentWorkspaceId: undefined,
})

const archivedLabel = (iso: string): string => {
  const d = new Date(iso)
  return `归档于 ${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

const archivedInstant = (iso: string): string => {
  const d = new Date(iso)
  const pad2 = (v: number): string => String(v).padStart(2, '0')
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

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

  it('renders the archive date under each row title, with fallbacks', () => {
    mount()
    expect(screen.getByText(archivedLabel('2026-08-20T10:30:00.000Z'))).toBeTruthy()
    expect(screen.getByText('归档时间未知')).toBeTruthy()
    expect(screen.getByText('归档于 —')).toBeTruthy()
  })

  it('opens the details dialog with the full fixed field set and closes it', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: '对话详情 alpha-1' }))
    const dialog = screen.getByRole('dialog', { name: '对话详情' })
    expect(dialog.textContent).toContain('alpha')
    expect(dialog.textContent).toContain('/w/alpha')
    expect(dialog.textContent).toContain('default')
    expect(dialog.textContent).toContain(archivedInstant('2026-08-20T10:30:00.000Z'))
    expect(dialog.textContent).toContain(archivedInstant('2026-08-19T01:00:00.000Z'))
    expect(dialog.textContent).toContain('空闲')
    expect(dialog.textContent).toContain('a1')
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog', { name: '对话详情' })).toBeNull()
  })

  it('omits directory and preset rows and reports unknown times for a lean legacy row', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: '对话详情 alpha-2' }))
    const dialog = screen.getByRole('dialog', { name: '对话详情' })
    expect(dialog.textContent).toContain('归档时间未知')
    expect(dialog.textContent).not.toContain('目录')
    expect(dialog.textContent).not.toContain('Agent 预设')
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  })

  it('shows the running status and the dash for a zero activity time in details', () => {
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
    fireEvent.click(screen.getByRole('button', { name: '对话详情 loose' }))
    const dialog = screen.getByRole('dialog', { name: '对话详情' })
    expect(dialog.textContent).toContain('未分组')
    expect(dialog.textContent).toContain('运行中')
    expect(dialog.textContent).toContain('—')
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
