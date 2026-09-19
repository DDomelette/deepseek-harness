// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { PinnedSessionRow, type PinnedRowNode } from '../src/client/PinnedSessionRow.tsx'

afterEach(cleanup)

type RowProps = ComponentProps<typeof PinnedSessionRow>

function renderRow(node: Partial<PinnedRowNode> = {}, overrides: Partial<RowProps> = {}) {
  const props: RowProps = {
    node: {
      id: 'pinned' as SessionId, title: 'Pinned session', blank: false,
      running: false, completed: false, updatedAt: 0, ...node,
    },
    currentId: undefined,
    now: 0,
    onOpen: vi.fn(), onRename: vi.fn(), onFork: vi.fn(), onArchive: vi.fn(),
    pinAction: <button type="button">Unpin</button>,
    flat: false,
    t: key => key,
    ...overrides,
  }
  const view = render(<PinnedSessionRow {...props} />)
  return { ...view, props }
}

/** jsdom has no DragEvent constructor, so its event needs an explicit pointer coordinate. */
function dragEvent(row: HTMLElement, kind: 'dragOver' | 'drop', clientY: number): Event {
  const event = createEvent[kind](row)
  Object.defineProperty(event, 'clientY', { value: clientY })
  fireEvent(row, event)
  return event
}

describe('pinned session row', () => {
  it('opens the selected session and keeps menu activation separate from navigation', () => {
    const { props } = renderRow({}, { currentId: 'pinned' as SessionId })
    const row = screen.getByRole('treeitem')
    expect(row.getAttribute('aria-selected')).toBe('true')
    expect(row.getAttribute('draggable')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'actions.session.aria' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(props.onOpen).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(row)
    expect(props.onOpen).toHaveBeenCalledWith(props.node.id)
  })

  it.each([
    ['approval', 'status.waitingApproval'],
    ['plan-review', 'status.planReview'],
    ['question', 'status.waitingAnswer'],
  ] as const)('shows %s ahead of ongoing work and completion', (pendingInteraction, label) => {
    renderRow({ pendingInteraction, running: true, completed: true }, { flat: true })
    const row = screen.getByRole('treeitem')
    expect(row.querySelector('[data-state="warning"]')).not.toBeNull()
    expect(row.querySelector('[data-state="ongoing"]')).toBeNull()
    expect(row.querySelector('[data-state="done"]')).toBeNull()
    expect(screen.getByText(label)).toBeTruthy()
  })

  it('omits an idle flat row status slot and restores it for activity or completion', () => {
    const { props, rerender } = renderRow({}, { flat: true })
    expect(screen.getByText('Pinned session').previousElementSibling).toBeNull()
    rerender(<PinnedSessionRow {...props} node={{ ...props.node, running: true, completed: true }} />)
    expect(screen.getByText('status.running')).toBeTruthy()
    expect(screen.getByRole('treeitem').querySelector('[data-state="ongoing"]')).not.toBeNull()
    rerender(<PinnedSessionRow {...props} node={{ ...props.node, completed: true }} />)
    expect(screen.getByText('status.completed')).toBeTruthy()
    expect(screen.getByRole('treeitem').querySelector('[data-state="done"]')).not.toBeNull()
  })

  it('leaves blank rows without timestamps, actions, or hover previews', () => {
    vi.useFakeTimers()
    try {
      renderRow({ blank: true })
      expect(screen.queryByRole('button')).toBeNull()
      expect(screen.queryByText('time.now')).toBeNull()
      fireEvent.pointerEnter(screen.getByRole('treeitem'))
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getAllByText('Pinned session')).toHaveLength(1)
      expect(screen.queryByText('status.idle')).toBeNull()
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })

  it.each([
    [0, 'time.now', 'time.now'],
    [60_000, 'time.minutes', 'time.ago'],
  ] as const)('shows relative time and idle status on hover at %s ms', (now, rowTime, hoverTime) => {
    vi.useFakeTimers()
    try {
      renderRow({}, { now })
      expect(screen.getByText(rowTime)).toBeTruthy()
      fireEvent.pointerEnter(screen.getByRole('treeitem').parentElement as HTMLElement)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getAllByText('Pinned session')).toHaveLength(2)
      expect(screen.getAllByText(hoverTime)).toHaveLength(now === 0 ? 2 : 1)
      expect(screen.getByText('status.idle')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'actions.session.aria' }))
      expect(screen.getAllByText('Pinned session')).toHaveLength(1)
      expect(screen.queryByText('status.idle')).toBeNull()
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })

  it('starts and ends a move while rejecting hover and drop outside an active drag', () => {
    const drag = {
      active: false as const, marker: null,
      start: vi.fn(), end: vi.fn(),
    }
    const { props } = renderRow({}, { drag })
    const row = screen.getByRole('treeitem')
    const dataTransfer = { effectAllowed: '', setData: vi.fn() }
    expect(row.getAttribute('draggable')).toBe('true')
    fireEvent.dragStart(row, { dataTransfer })
    expect(dataTransfer.effectAllowed).toBe('move')
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', props.node.id)
    expect(drag.start).toHaveBeenCalledOnce()
    expect(dragEvent(row, 'dragOver', 0).defaultPrevented).toBe(false)
    expect(dragEvent(row, 'drop', 0).defaultPrevented).toBe(false)
    fireEvent.dragEnd(row)
    expect(drag.end).toHaveBeenCalledOnce()
  })

  it.each([
    ['before', 105],
    ['after', 125],
  ] as const)('inserts %s the hovered row and suppresses its preview during a drag', (half, clientY) => {
    vi.useFakeTimers()
    try {
      const drag = {
        active: true as const, marker: half,
        start: vi.fn(), hover: vi.fn(), drop: vi.fn(), end: vi.fn(),
      }
      renderRow({}, { drag })
      const row = screen.getByRole('treeitem')
      row.getBoundingClientRect = () => ({
        x: 0, y: 100, top: 100, bottom: 132, left: 0, right: 200, width: 200, height: 32,
        toJSON: () => ({}),
      })
      expect(dragEvent(row, 'dragOver', clientY).defaultPrevented).toBe(true)
      expect(drag.hover).toHaveBeenCalledWith(half)
      expect(dragEvent(row, 'drop', clientY).defaultPrevented).toBe(true)
      expect(drag.drop).toHaveBeenCalledWith(half)
      fireEvent.pointerEnter(row.parentElement as HTMLElement)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getAllByText('Pinned session')).toHaveLength(1)
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })
})
