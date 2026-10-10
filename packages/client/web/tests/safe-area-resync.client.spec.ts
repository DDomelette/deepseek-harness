// @vitest-environment jsdom
/** The orientation-change safe-area resync re-reads the root's env() padding. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBrowserCompat } from '../src/compat.ts'

let offsetHeightReads: number

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>'
  offsetHeightReads = 0
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement): number {
      if (this.id === 'root') offsetHeightReads += 1
      return 0
    },
  })
  vi.useFakeTimers()
  // Run animation frames synchronously so the rAF-scheduled resyncs fire
  // inside the dispatch/assertion window.
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    callback(0)
    return 0
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  delete (HTMLElement.prototype as { offsetHeight?: unknown }).offsetHeight
  document.body.innerHTML = ''
})

describe('safe-area inset resync', () => {
  it('re-resolves the root padding on orientationchange, on frames and after the animation budget', () => {
    installBrowserCompat()
    const root = document.getElementById('root')

    window.dispatchEvent(new Event('orientationchange'))

    // Immediate double-rAF pass plus the delayed one.
    expect(offsetHeightReads).toBe(1)
    expect(root?.style.paddingTop).toBe('')
    vi.advanceTimersByTime(400)
    expect(offsetHeightReads).toBe(2)
    expect(root?.style.paddingTop).toBe('')
  })

  it('leaves no inline padding behind on the root', () => {
    installBrowserCompat()
    window.dispatchEvent(new Event('orientationchange'))
    vi.advanceTimersByTime(400)
    const root = document.getElementById('root')
    // jsdom keeps an empty `style` attribute once touched; the contract is
    // that no inline padding declaration survives.
    expect(root?.style.cssText).toBe('')
  })

  it('does nothing when the shell root is absent', () => {
    document.getElementById('root')?.remove()
    installBrowserCompat()
    expect(() => {
      window.dispatchEvent(new Event('orientationchange'))
      vi.advanceTimersByTime(400)
    }).not.toThrow()
    expect(offsetHeightReads).toBe(0)
  })
})
