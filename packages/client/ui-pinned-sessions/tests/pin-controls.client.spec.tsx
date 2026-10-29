// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { SearchPinBadge } from '../src/client/SearchPinBadge.tsx'
import { SessionPinAction } from '../src/client/SessionPinAction.tsx'
import { createPinnedSessionsStore } from '../src/client/stores.ts'

afterEach(cleanup)

function fixture() {
  const store = createPinnedSessionsStore().create()
  const props: ComponentProps<typeof SessionPinAction> = {
    sessionId: 'session' as SessionId, blank: false, flat: false,
    useSessions: () => { throw new Error('unused') },
    useWorkspaces: () => { throw new Error('unused') },
    usePanelInfo: () => { throw new Error('unused') },
    useSessionPendingInteraction: () => { throw new Error('unused') },
    useResource: () => { throw new Error('unused') },
    useStore: selector => selector(store.getSnapshot()),
    actions: store.actions, setPinned: vi.fn(async () => {}), t: key => key,
  }
  return { props, store }
}

describe('pin controls', () => {
  it('shows a search badge only after confirmed pin membership arrives', () => {
    const { props, store } = fixture()
    const view = render(<SearchPinBadge {...props} />)
    expect(screen.queryByLabelText('pinnedBadge')).toBeNull()
    store.actions.commit({ pinnedSessionIds: [], groupOrder: {}, flatOrder: [] })
    view.rerender(<SearchPinBadge {...props} />)
    expect(screen.queryByLabelText('pinnedBadge')).toBeNull()
    store.actions.commit({ pinnedSessionIds: [props.sessionId], groupOrder: {}, flatOrder: [] })
    view.rerender(<SearchPinBadge {...props} />)
    expect(screen.getByLabelText('pinnedBadge')).toBeTruthy()
  })

  it('hides blank and not-yet-loaded actions, then toggles membership without selecting the row', () => {
    const { props, store } = fixture()
    const open = vi.fn()
    const view = render(<div onClick={open}><SessionPinAction {...props} /></div>)
    expect(screen.queryByRole('button')).toBeNull()
    store.actions.commit({ pinnedSessionIds: [], groupOrder: {}, flatOrder: [] })
    view.rerender(<div onClick={open}><SessionPinAction {...props} blank /></div>)
    expect(screen.queryByRole('button')).toBeNull()
    view.rerender(<div onClick={open}><SessionPinAction {...props} /></div>)
    fireEvent.click(screen.getByRole('button', { name: 'pin' }))
    expect(props.setPinned).toHaveBeenLastCalledWith(props.sessionId, true, store.getSnapshot().snapshot)
    store.actions.commit({ pinnedSessionIds: [props.sessionId], groupOrder: {}, flatOrder: [] })
    view.rerender(<div onClick={open}><SessionPinAction {...props} /></div>)
    fireEvent.click(screen.getByRole('button', { name: 'unpin' }))
    expect(props.setPinned).toHaveBeenLastCalledWith(props.sessionId, false, store.getSnapshot().snapshot)
    expect(open).not.toHaveBeenCalled()
  })
})
