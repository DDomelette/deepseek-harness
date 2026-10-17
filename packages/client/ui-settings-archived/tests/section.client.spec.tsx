// @vitest-environment jsdom
/** Archived settings section: grouping, archive dates, details, restore, and delete. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import { type SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { type WorkspaceSnapshot as WorkspaceListState } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { ArchivedSection, type ArchivedSectionInjected, type ArchivedSectionProps } from '../src/client/ArchivedSection.tsx'
import { zh, type ArchivedSettingsKey } from '../src/client/locales.ts'

const sid = (id: string): SessionId => id as SessionId
const wid = (id: string): WorkspaceId => id as WorkspaceId

const A1_ARCHIVED_AT = '2026-08-19T08:00:00.000Z'
const A2_ARCHIVED_AT = '2026-08-18T08:00:00.000Z'

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
      running: false, blank: false, cwd: '/w/alpha', projectionValues: { agentPreset: 'default' },
      retainedBy: {},
    },
    [sid('a2')]: {
      id: sid('a2'), displayTitle: 'alpha-2', updatedAt: Date.parse('2026-08-18T01:00:00.000Z'),
      running: false, blank: false, retainedBy: {},
    },
    [sid('loose')]: {
      id: sid('loose'), displayTitle: 'loose', updatedAt: 0, running: false, blank: false,
      retainedBy: {},
    },
    // A subagent child of alpha-1 that no archived group lists: it exists only
    // so the delete confirmation counts it as a removed descendant.
    [sid('a1-child')]: {
      id: sid('a1-child'), displayTitle: 'alpha-1 child', updatedAt: 0, running: false,
      blank: false, parentId: sid('a1'), retainedBy: {},
    },
  },
  phase: 'ready',
  projectionsBySession: {},
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
  archivedSessionAts: { [sid('a1')]: A1_ARCHIVED_AT, [sid('a2')]: A2_ARCHIVED_AT },
  pinnedSessionIds: [],
  state: 'idle',
  phase: 'ready',
  error: null,
})

/** Details-dialog instant: the dictionary's date template plus the local clock. */
const instant = (value: number | string): string => {
  const d = new Date(value)
  const pad2 = (v: number): string => String(v).padStart(2, '0')
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Row instant: the dictionary's date template alone. */
const archivedDate = (value: string): string => {
  const d = new Date(value)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

const useSessions = <S,>(selector: (state: SessionListState) => S): S => selector(sessionsState())
const useWorkspaces = <S,>(selector: (state: WorkspaceListState) => S): S => selector(workspacesState())

function mount(
  injected: Partial<ArchivedSectionInjected> = {},
  overrides: Partial<ArchivedSectionProps> = {},
): ArchivedSectionInjected {
  const resolved: ArchivedSectionInjected = {
    restore: vi.fn(async () => true),
    remove: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    ...injected,
  }
  render(<ArchivedSection
    usePanelInfo={() => { throw new Error('unused by ArchivedSection') }}
    useResource={() => { throw new Error('unused by ArchivedSection') }}
    useSessionStatus={() => { throw new Error('unused by ArchivedSection') }}
    useSessionRetainInfo={() => { throw new Error('unused by ArchivedSection') }}
    useSessions={useSessions}
    useWorkspaces={useWorkspaces}
    close={vi.fn()}
    t={t}
    restore={id => resolved.restore(id)}
    remove={id => resolved.remove(id)}
    refresh={() => resolved.refresh()}
    {...overrides}
  />)
  return resolved
}

afterEach(cleanup)

describe('ArchivedSection', () => {
  it('shows loading until both baselines arrive and an empty message with no archived sessions', () => {
    mount({}, { useSessions: selector => selector({ ...sessionsState(), phase: 'pending' }) })
    expect(screen.getByText(zh.loading)).toBeTruthy()
    cleanup()
    mount({}, { useWorkspaces: selector => selector({ ...workspacesState(), archivedSessionIds: [] }) })
    expect(screen.getByText(zh.empty)).toBeTruthy()
  })

  it.each([null, new RemoteError('gateway/internal', 'Offline', {})])('retries a failed workspace baseline with error %j', async (error) => {
    const refresh = vi.fn(async () => {})
    mount({ refresh }, {
      useWorkspaces: selector => selector({ ...workspacesState(), state: 'error', error }),
    })
    expect(screen.getByRole('alert').textContent).toContain(zh.loadFailed)
    if (error !== null) expect(screen.getByRole('alert').textContent).toContain(error.message)
    fireEvent.click(screen.getByRole('button', { name: zh.retry }))
    await waitFor(() => { expect(refresh).toHaveBeenCalledOnce() })
  })

  it('keeps restore failures on their rows and clears only the recovered row after retry', async () => {
    const restore = vi.fn<ArchivedSectionInjected['restore']>()
      .mockRejectedValueOnce(new Error('First restore failed'))
      .mockRejectedValueOnce('Second restore failed')
      .mockResolvedValueOnce(false)
    const close = vi.fn()
    mount({ restore }, { close })
    fireEvent.click(screen.getByRole('button', { name: '恢复对话 alpha-1' }))
    await screen.findByText('First restore failed')
    fireEvent.click(screen.getByRole('button', { name: '恢复对话 alpha-2' }))
    await screen.findByText('Second restore failed')
    fireEvent.click(screen.getByRole('button', { name: '恢复对话 alpha-1' }))
    await waitFor(() => { expect(screen.queryByText('First restore failed')).toBeNull() })
    expect(screen.getByText('Second restore failed')).toBeTruthy()
    expect(close).not.toHaveBeenCalled()
  })

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

  it('renders the archive date inline and marks a pre-field archive as unknown', () => {
    mount()
    expect(screen.getByText(`归档于 ${archivedDate(A1_ARCHIVED_AT)}`)).toBeTruthy()
    expect(screen.getByText(`归档于 ${archivedDate(A2_ARCHIVED_AT)}`)).toBeTruthy()
    expect(screen.getByText(zh['row.archivedAtUnknown'])).toBeTruthy()
  })

  it('opens the details dialog with the full fixed field set and closes it', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: '对话详情 alpha-1' }))
    const dialog = screen.getByRole('dialog', { name: '对话详情' })
    expect(dialog.textContent).toContain('alpha')
    expect(dialog.textContent).toContain('/w/alpha')
    expect(dialog.textContent).toContain('default')
    expect(dialog.textContent).toContain(instant(A1_ARCHIVED_AT))
    expect(dialog.textContent).toContain(instant(Date.parse('2026-08-19T01:00:00.000Z')))
    expect(dialog.textContent).toContain('空闲')
    expect(dialog.textContent).toContain('a1')
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog', { name: '对话详情' })).toBeNull()
  })

  it('omits directory and preset rows for a lean legacy row', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: '对话详情 alpha-2' }))
    const dialog = screen.getByRole('dialog', { name: '对话详情' })
    expect(dialog.textContent).not.toContain('目录')
    expect(dialog.textContent).not.toContain('Agent 预设')
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  })

  it('shows the running status and the dash for a zero activity time in details', () => {
    const original = sessionsState()
    original.byId[sid('loose')] = { ...original.byId[sid('loose')]!, running: true }
    const runningSessions = <S,>(selector: (state: SessionListState) => S): S => selector(original)
    mount({}, { useSessions: runningSessions })
    fireEvent.click(screen.getByRole('button', { name: '对话详情 loose' }))
    const dialog = screen.getByRole('dialog', { name: '对话详情' })
    expect(dialog.textContent).toContain('未分组')
    expect(dialog.textContent).toContain('运行中')
    expect(dialog.textContent).toContain('—')
  })

  it('restores a row and closes settings when restore reports opened', async () => {
    const restore = vi.fn(async () => true)
    const close = vi.fn()
    mount({ restore }, { close })
    fireEvent.click(screen.getByRole('button', { name: '恢复对话 alpha-1' }))
    await waitFor(() => { expect(restore).toHaveBeenCalledWith(sid('a1')) })
    expect(close).toHaveBeenCalledOnce()
  })

  it('confirms a recursive delete with the descendant count and closes the confirmation', async () => {
    const remove = vi.fn(async () => {})
    mount({ remove })
    fireEvent.click(screen.getByRole('button', { name: '删除对话 alpha-1' }))
    const confirm = screen.getByRole('dialog', { name: '删除对话？' })
    expect(confirm.textContent).toContain('1 个子代理对话')
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => { expect(remove).toHaveBeenCalledWith(sid('a1')) })
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '删除对话？' })).toBeNull() })
  })

  it('cancels without deleting and keeps a refused deletion in its open confirmation', async () => {
    const remove = vi.fn<ArchivedSectionInjected['remove']>().mockRejectedValueOnce(new Error('Delete failed'))
    mount({ remove })
    fireEvent.click(screen.getByRole('button', { name: '删除对话 alpha-2' }))
    // The dialog's dismiss control and the footer's Cancel share one label.
    const confirm = screen.getByRole('dialog', { name: '删除对话？' })
    fireEvent.click(within(confirm).getAllByRole('button', { name: '取消' }).at(-1)!)
    expect(screen.queryByRole('dialog', { name: '删除对话？' })).toBeNull()
    expect(remove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '删除对话 alpha-2' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await screen.findByText('Delete failed')
    expect(remove).toHaveBeenCalledWith(sid('a2'))
    expect(screen.getByRole('dialog', { name: '删除对话？' })).toBeTruthy()
  })

  it('disables both confirmation controls while the deletion is pending', async () => {
    let settle: (() => void) | undefined
    const remove = vi.fn<ArchivedSectionInjected['remove']>(() => new Promise<void>((resolve) => {
      settle = resolve
    }))
    mount({ remove })
    fireEvent.click(screen.getByRole('button', { name: '删除对话 alpha-1' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    const confirm = screen.getByRole('dialog', { name: '删除对话？' })
    // Confirm and Cancel are the two disabled controls; the dialog's own
    // dismiss control stays enabled but its dismissal is ignored below.
    const disabledControls = within(confirm).getAllByRole('button')
      .filter(control => (control as HTMLButtonElement).disabled)
    expect(disabledControls).toHaveLength(2)
    // Dismissal is ignored until the pending deletion settles.
    fireEvent.keyDown(confirm, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: '删除对话？' })).toBeTruthy()
    settle?.()
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '删除对话？' })).toBeNull() })
  })

  it('refuses to delete a running conversation', () => {
    const original = sessionsState()
    original.byId[sid('loose')] = { ...original.byId[sid('loose')]!, running: true }
    const runningSessions = <S,>(selector: (state: SessionListState) => S): S => selector(original)
    mount({}, { useSessions: runningSessions })
    const button = screen.getByRole('button', { name: '删除对话 loose' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})
