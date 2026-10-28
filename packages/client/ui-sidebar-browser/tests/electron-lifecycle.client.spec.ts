// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { DesktopBrowserReservation } from '../src/types.ts'
import { ElectronWebviewPresentation } from '../src/client/electron/ElectronWebviewPresentation.ts'
import { electronFixture } from './electron-harness.client.ts'

const target = { kind: 'https' as const, url: 'https://example.test/', title: 'Example' }
const fixtures: ReturnType<typeof electronFixture>[] = []
function fixture() {
  const h = electronFixture()
  fixtures.push(h)
  return h
}
afterEach(async () => {
  for (const h of fixtures.splice(0)) await h.dispose()
  vi.restoreAllMocks()
})

it('waits for a mounted container and observes native history, titles and new-tab requests', async () => {
  const h = fixture()
  h.frame.goBack()
  h.frame.goForward()
  h.frame.reload()
  h.frame.loadUrl(target)
  expect(h.bridge.acquire).not.toHaveBeenCalled()
  h.mount()
  const guest = await h.guest()
  expect(guest.element.getAttribute('name')).toBe(h.reservation.lease)
  expect(guest.element.getAttribute('partition')).toBe(h.reservation.partition)
  expect(guest.element.getAttribute('src')).toBe(`about:blank#${h.reservation.lease}`)
  guest.emit('dom-ready')
  expect(guest.loadURL).toHaveBeenCalledWith(target.url)
  guest.state.url = target.url
  guest.state.title = 'Title'
  guest.state.back = true
  guest.state.forward = true
  guest.emit('did-navigate')
  expect(guest.clearHistory).toHaveBeenCalledOnce()
  expect(h.frame.getSnapshot()).toMatchObject({ address: 'observed', target: { ...target, title: 'Title' } })
  expect(guest.element.getAttribute('aria-label')).toBe('Title')
  const writes = h.persist.mock.calls.length
  guest.emit('page-title-updated')
  expect(h.persist).toHaveBeenCalledTimes(writes)
  h.frame.loadUrl(target)
  h.frame.goBack()
  h.frame.goForward()
  expect(guest.reload).toHaveBeenCalledOnce()
  expect(guest.goBack).toHaveBeenCalledOnce()
  expect(guest.goForward).toHaveBeenCalledOnce()
  guest.state.url = `${target.url}next`
  guest.emit('did-navigate-in-page', { isMainFrame: false })
  expect(h.frame.getSnapshot().target?.url).toBe(target.url)
  guest.emit('did-navigate-in-page', { isMainFrame: true })
  guest.state.title = ''
  guest.state.loading = false
  guest.emit('page-title-updated')
  guest.emit('did-stop-loading')
  expect(h.frame.getSnapshot()).toMatchObject({ loading: false, target: { url: guest.state.url, title: 'example.test' } })
  const open = h.bridge.onOpenRequested.mock.calls[0]![1]
  open('https://new.example/')
  expect(h.openRequested).toHaveBeenCalledOnce()
  await h.frame.dispose()
  open('https://late.example/')
  guest.emit('did-navigate')
  h.frame.loadUrl(target)
  h.frame.reload()
  h.frame.goBack()
  expect(h.openRequested).toHaveBeenCalledOnce()
  expect(h.opens.size).toBe(0)
  expect(h.bridge.release).toHaveBeenCalledExactlyOnceWith(h.reservation.lease)
})

it('releases an acquisition that finishes after attachment cancellation', async () => {
  const h = fixture()
  const pending = Promise.withResolvers<DesktopBrowserReservation>()
  h.bridge.acquire.mockReturnValueOnce(pending.promise)
  const unmount = h.mount()
  h.frame.loadUrl(target)
  try {
    await vi.waitFor(() => { expect(h.bridge.acquire).toHaveBeenCalledOnce() })
    unmount()
    const disposed = h.frame.dispose()
    expect(h.frame.dispose()).toBe(disposed)
    pending.resolve(h.reservation)
    await disposed
    expect(h.guests).toHaveLength(0)
    expect(h.bridge.release).toHaveBeenCalledExactlyOnceWith(h.reservation.lease)
  } finally {
    pending.resolve(h.reservation)
  }
})

it('does not acquire a guest when Workspace resolution finishes after disposal', async () => {
  const h = fixture()
  const pending = Promise.withResolvers<string>()
  h.workspace.mockReturnValueOnce(pending.promise)
  h.mount()
  h.frame.loadUrl(target)
  try {
    const disposed = h.frame.dispose()
    pending.resolve('cwd:/late')
    await disposed
    expect(h.bridge.acquire).not.toHaveBeenCalled()
    h.mount()
    expect(h.guests).toHaveLength(0)
  } finally {
    pending.resolve('cwd:/late')
  }
})

it('recreates the guest after physical remount or crash without resolving Workspace again', async () => {
  const h = fixture()
  const unmount = h.mount()
  h.frame.loadUrl(target)
  const first = await h.guest()
  first.emit('dom-ready')
  unmount()
  h.mount()
  const second = await h.guest()
  expect(second.element).not.toBe(first.element)
  expect(h.workspace).toHaveBeenCalledOnce()
  second.emit('dom-ready')
  expect(second.loadURL).toHaveBeenCalledWith(target.url)
  second.emit('render-process-gone')
  expect(h.frame.getSnapshot().error).toBeDefined()
  h.frame.reload()
  const third = await h.guest()
  third.emit('dom-ready')
  expect(third.loadURL).toHaveBeenCalledWith(target.url)
  expect(h.frame.getSnapshot().error).toBeUndefined()
  third.emit('destroyed')
  expect(h.frame.getSnapshot().error).toBeDefined()
})

it('contains acquisition, native command and release failures and keeps retry available', async () => {
  const h = fixture()
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  h.bridge.acquire.mockRejectedValueOnce(new Error('acquire failed'))
  h.mount()
  h.frame.loadUrl(target)
  await vi.waitFor(() => { expect(h.frame.getSnapshot().error).toBeDefined() })
  h.frame.reload()
  const guest = await h.guest()
  guest.emit('dom-ready')
  guest.state.url = target.url
  guest.emit('did-navigate')
  guest.reload.mockImplementationOnce(() => { throw new Error('command failed') })
  h.frame.reload()
  expect(h.frame.getSnapshot().error).toBeDefined()
  h.frame.reload()
  expect(h.frame.getSnapshot().error).toBeUndefined()
  guest.getURL.mockImplementationOnce(() => { throw new Error('observation failed') })
  guest.emit('did-navigate')
  expect(h.frame.getSnapshot().error).toBeDefined()
  h.bridge.release.mockRejectedValueOnce(new Error('release failed'))
  await h.frame.dispose()
  expect(error.mock.calls.some(call => call[0] === 'Desktop browser guest release failed')).toBe(true)
})

it('ignores superseded and aborted load promises, but publishes an active navigation rejection', async () => {
  const h = fixture()
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  h.mount()
  h.frame.loadUrl(target)
  const guest = await h.guest()
  const stale = Promise.withResolvers<undefined>()
  guest.loadURL.mockReturnValueOnce(stale.promise)
  guest.emit('dom-ready')
  h.frame.loadUrl({ ...target, url: 'https://example.test/new' })
  stale.reject(new Error('old navigation failed'))
  await expect(stale.promise).rejects.toThrow('old navigation')
  expect(h.frame.getSnapshot().error).toBeUndefined()
  guest.loadURL.mockRejectedValueOnce(Object.assign(new Error('aborted'), { code: 'ERR_ABORTED' }))
  h.frame.loadUrl({ ...target, url: 'https://example.test/cancelled' })
  await Promise.resolve()
  expect(h.frame.getSnapshot().error).toBeUndefined()
  guest.loadURL.mockRejectedValueOnce(new Error('active navigation failed'))
  h.frame.loadUrl(target)
  await vi.waitFor(() => { expect(h.frame.getSnapshot().error).toBeDefined() })
  expect(error).toHaveBeenCalledOnce()
})

it('restarts a remounted attachment after the old acquisition rejects without publishing its error', async () => {
  const h = fixture()
  const pending = Promise.withResolvers<DesktopBrowserReservation>()
  h.bridge.acquire.mockReturnValueOnce(pending.promise)
  const unmount = h.mount()
  h.frame.loadUrl(target)
  try {
    await vi.waitFor(() => { expect(h.bridge.acquire).toHaveBeenCalledOnce() })
    unmount()
    h.mount()
    pending.reject(new Error('old attachment rejected'))
    const guest = await h.guest()
    expect(h.bridge.acquire).toHaveBeenCalledTimes(2)
    expect(h.frame.getSnapshot().error).toBeUndefined()
    guest.emit('dom-ready')
    expect(guest.loadURL).toHaveBeenCalledExactlyOnceWith(target.url)
  } finally {
    pending.resolve(h.reservation)
  }
})

it('ignores pre-ready load events, repeated ready events, subframe failures and aborted main-frame loads', async () => {
  const h = fixture()
  h.mount()
  h.frame.loadUrl(target)
  const guest = await h.guest()
  const requested = h.frame.getSnapshot()
  guest.emit('did-start-loading')
  expect(h.frame.getSnapshot()).toBe(requested)
  guest.emit('did-fail-load', { isMainFrame: false, errorCode: -105, errorDescription: 'subframe failed' })
  guest.emit('did-fail-load', { isMainFrame: true, errorCode: -3, errorDescription: 'aborted' })
  expect(h.frame.getSnapshot().error).toBeUndefined()
  guest.emit('dom-ready')
  guest.emit('dom-ready')
  expect(guest.loadURL).toHaveBeenCalledExactlyOnceWith(target.url)
})

it('retains native navigation failure details when its load promise rejects afterward', async () => {
  const h = fixture()
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const pending = Promise.withResolvers<undefined>()
  h.mount()
  h.frame.loadUrl(target)
  const guest = await h.guest()
  guest.loadURL.mockReturnValueOnce(pending.promise)
  guest.emit('dom-ready')
  guest.emit('did-fail-load', { isMainFrame: true, errorCode: -105, errorDescription: 'NAME_NOT_RESOLVED' })
  pending.reject(new Error('load promise failed'))
  await expect(pending.promise).rejects.toThrow('load promise failed')
  expect(h.frame.getSnapshot().error).toEqual({ code: -105, description: 'NAME_NOT_RESOLVED' })
  expect(error).not.toHaveBeenCalled()
})

it('requires a mounted container and leaves a replacement host attached when the old disposer runs', () => {
  const mounted = vi.fn(), unmounted = vi.fn()
  const presentation = new ElectronWebviewPresentation({ mounted, unmounted })
  const first = document.createElement('div'), second = document.createElement('div')
  first.id = 'electron-first-container'
  second.id = 'electron-second-container'
  document.body.append(first, second)
  try {
    expect(() => presentation.mount('missing-electron-container')).toThrow('content container is not mounted')
    const h = fixture()
    const guest = presentation.createElement(h.reservation)
    expect(() => { presentation.present(guest) }).toThrow('cannot attach without a content container')
    presentation.show('No mounted guest')
    const old = presentation.mount(first.id)
    const current = presentation.mount(second.id)
    expect(unmounted).toHaveBeenCalledOnce()
    old()
    expect(unmounted).toHaveBeenCalledOnce()
    presentation.present(guest)
    expect(second.firstElementChild).toBe(guest)
    current()
    expect(unmounted).toHaveBeenCalledTimes(2)
    expect(mounted).toHaveBeenCalledTimes(2)
  } finally {
    presentation.dispose()
    first.remove()
    second.remove()
  }
})

it('keeps its last snapshot when a synchronous navigation observer disposes the frame', async () => {
  const h = fixture()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  h.mount()
  h.frame.loadUrl(target)
  const guest = await h.guest()
  guest.emit('dom-ready')
  guest.state.loading = false
  guest.emit('did-stop-loading')
  let disposal: Promise<void> | undefined
  const observed = vi.fn(() => { disposal = h.frame.dispose() })
  const unsubscribe = h.frame.subscribe(observed)
  try {
    h.frame.reload()
    const stopped = h.frame.getSnapshot()
    expect(observed).toHaveBeenCalledOnce()
    expect(disposal).toBeDefined()
    await disposal
    expect(h.frame.getSnapshot()).toBe(stopped)
    expect(stopped.error).toBeUndefined()
    expect(h.bridge.release).toHaveBeenCalledExactlyOnceWith(h.reservation.lease)
  } finally {
    unsubscribe()
  }
})
