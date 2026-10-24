// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

const boot = vi.hoisted(() => ({ mount: vi.fn(), run: vi.fn() }))
vi.mock('@deepseek-ai/dsh-client-web', () => ({
  AppWebEntry: class {
    constructor(element: HTMLElement) { boot.mount(element) }
    run = boot.run
  },
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  vi.resetModules()
  document.body.replaceChildren()
})

it.each([false, true])('starts the Web kernel with the current Desktop marker (%s)', async (desktop) => {
  document.body.innerHTML = '<div id="root"></div>'
  vi.stubGlobal('dshDesktop', desktop ? { protocolVersion: 1 } : undefined)
  await import('../src/main.ts')
  expect(boot.mount).toHaveBeenCalledExactlyOnceWith(document.getElementById('root'))
  expect(boot.run).toHaveBeenCalledExactlyOnceWith()
})

it('rejects a missing root before starting the client kernel', async () => {
  await expect(import('../src/main.ts')).rejects.toThrow('web app: missing #root')
  expect(boot.mount).not.toHaveBeenCalled()
  expect(boot.run).not.toHaveBeenCalled()
})

it.each([false, true])('keeps service-worker registration outside client startup (offline: %s)', async (offline) => {
  document.body.innerHTML = '<div id="root"></div>'
  const register = vi.fn(() => offline ? Promise.reject(new Error('offline')) : Promise.resolve({}))
  vi.stubGlobal('navigator', { serviceWorker: { register } })
  const add = vi.spyOn(window, 'addEventListener')
  try {
    await import('../src/main.ts')
    expect(boot.run).toHaveBeenCalledOnce()
    expect(register).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('load'))
    await Promise.resolve()
    expect(register).toHaveBeenCalledExactlyOnceWith('/sw.js')
  } finally {
    for (const [type, listener, options] of add.mock.calls) {
      if (type === 'load') window.removeEventListener(type, listener, options)
    }
    add.mockRestore()
  }
})
