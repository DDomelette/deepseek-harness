// @vitest-environment jsdom
/**
 * PairScreen: the phone's pairing screen polls the Host, shows the code and the
 * copy that matches the decision, and leaves for the application root once the
 * computer approves.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { PairScreen, pairingBootFact, readPairingState, type PairingStateView } from '../src/client/PairScreen.tsx'
import { zh, type PairScreenKey } from '../src/client/pair-locales.ts'

const CODE = 'ABCD2345'

const t: TranslateNS<'pair.mobile'> = (key, params): string => {
  const template = zh[key as PairScreenKey]
  return Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  )
}

const unused = (): never => { throw new Error('unused by PairScreen') }

function mount(
  pollState: () => Promise<PairingStateView>,
  navigate: (path: string) => void = vi.fn(),
): { navigate: (path: string) => void; polls: () => number } {
  const poll = vi.fn(pollState)
  render(<PairScreen
    usePanelInfo={unused as never}
    useResource={unused as never}
    useSessionPendingInteraction={unused as never}
    useSessions={unused as never}
    useWorkspaces={unused as never}
    t={t}
    code={CODE}
    pollState={poll}
    navigate={navigate}
  />)
  return { navigate, polls: () => poll.mock.calls.length }
}

/** Answer one scripted sequence of states, then the last one forever. */
function scripted(...states: PairingStateView[]): () => Promise<PairingStateView> {
  let index = 0
  return async () => states[Math.min(index++, states.length - 1)]!
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, '__DSH_PAIR__')
})

describe('PairScreen', () => {
  it('shows the code and the waiting copy while the request is pending', async () => {
    mount(scripted({ status: 'pending' }))

    expect(screen.getByText('连接手机')).toBeTruthy()
    expect(screen.getByText('配对码')).toBeTruthy()
    expect(screen.getByText(CODE)).toBeTruthy()
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('请在电脑端确认这台手机以完成配对。') })
  })

  it('keeps polling while pending and leaves for the root once approved', async () => {
    vi.useFakeTimers()
    const navigate = vi.fn()
    const mounted = mount(scripted({ status: 'pending' }, { status: 'pending' }, { status: 'approved' }), navigate)

    await vi.waitFor(() => { expect(mounted.polls()).toBe(1) })
    await vi.advanceTimersByTimeAsync(1_500)
    await vi.waitFor(() => { expect(mounted.polls()).toBe(2) })
    await vi.advanceTimersByTimeAsync(1_500)
    await vi.waitFor(() => { expect(navigate).toHaveBeenCalledWith('/') })
  })

  it('stops polling on a denied, expired, or locked decision and shows its copy', async () => {
    vi.useFakeTimers()
    for (const [state, copy] of [
      [{ status: 'denied' }, '电脑端拒绝了这次配对请求。'],
      [{ status: 'expired' }, '该配对码已失效，请在电脑端重新生成。'],
      [{ status: 'unknown' }, '该配对码已失效，请在电脑端重新生成。'],
      [{ status: 'locked' }, '尝试次数过多，请在电脑端重新生成配对码后再试。'],
    ] as const) {
      cleanup()
      const mounted = mount(scripted(state))
      await vi.waitFor(() => { expect(screen.getByRole('status').textContent).toBe(copy) })
      await vi.advanceTimersByTimeAsync(3_000)
      expect(mounted.polls()).toBe(1)
    }
  })

  it('keeps waiting when the read itself fails', async () => {
    vi.useFakeTimers()
    const poll = vi.fn(async () => { throw new Error('carrier down') })
    const mounted = mount(poll)

    await vi.waitFor(() => { expect(screen.getByRole('status').textContent).toBe('请在电脑端确认这台手机以完成配对。') })
    await vi.advanceTimersByTimeAsync(1_500)
    await vi.waitFor(() => { expect(mounted.polls()).toBe(2) })
  })

  it('ignores an answer that arrives after the screen unmounted', async () => {
    let answer: ((state: PairingStateView) => void) | undefined
    const poll = vi.fn(async () => await new Promise<PairingStateView>((resolve) => { answer = resolve }))
    render(<PairScreen
      usePanelInfo={unused as never}
      useResource={unused as never}
      useSessionPendingInteraction={unused as never}
      useSessions={unused as never}
      useWorkspaces={unused as never}
      t={t}
      code={CODE}
      pollState={poll}
      navigate={vi.fn()}
    />)
    await vi.waitFor(() => { expect(poll).toHaveBeenCalledTimes(1) })

    cleanup()
    answer?.({ status: 'approved' })
    await Promise.resolve()
    expect(poll).toHaveBeenCalledTimes(1)
  })

  it('stops polling when the screen unmounts', async () => {
    vi.useFakeTimers()
    const poll = vi.fn(async (): Promise<PairingStateView> => ({ status: 'pending' }))
    render(<PairScreen
      usePanelInfo={unused as never}
      useResource={unused as never}
      useSessionPendingInteraction={unused as never}
      useSessions={unused as never}
      useWorkspaces={unused as never}
      t={t}
      code={CODE}
      pollState={poll}
      navigate={vi.fn()}
    />)
    await vi.waitFor(() => { expect(poll).toHaveBeenCalledTimes(1) })
    // Let the pending answer land and schedule the next poll before unmounting.
    await vi.advanceTimersByTimeAsync(0)

    cleanup()
    await vi.advanceTimersByTimeAsync(6_000)
    expect(poll).toHaveBeenCalledTimes(1)
  })
})

describe('pairing boot fact and state read', () => {
  it('reads the code the shell carried and nothing on other pages', () => {
    expect(pairingBootFact()).toBeUndefined()
    Reflect.set(globalThis, '__DSH_PAIR__', { code: CODE })
    expect(pairingBootFact()).toEqual({ code: CODE })

    Reflect.set(globalThis, '__DSH_PAIR__', { code: '' })
    expect(pairingBootFact()).toBeUndefined()
    Reflect.set(globalThis, '__DSH_PAIR__', 'nonsense')
    expect(pairingBootFact()).toBeUndefined()
  })

  it('asks the state route with the code and reads its answer', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'approved' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(readPairingState(CODE)).resolves.toEqual({ status: 'approved' })
    expect(fetchMock).toHaveBeenCalledWith(`/pair/state?c=${CODE}`, {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })

    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 503 }))
    await expect(readPairingState(CODE)).resolves.toEqual({ status: 'unknown' })
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'weird' }), { status: 200 }))
    await expect(readPairingState(CODE)).resolves.toEqual({ status: 'unknown' })
    fetchMock.mockResolvedValueOnce(new Response('null', { status: 200 }))
    await expect(readPairingState(CODE)).resolves.toEqual({ status: 'unknown' })
  })
})
