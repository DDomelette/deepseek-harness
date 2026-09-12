// @vitest-environment jsdom
/**
 * AuthRequiredScreen: the screen a non-loopback browser sees when the Host
 * served it the shell without accepting a session. It reads the boot fact the
 * refused shell carries, states that pairing has to happen on the computer
 * again, and offers the reload that picks up a cookie earned meanwhile.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { AuthRequiredScreen, authRequiredBootFact } from '../src/client/AuthRequiredScreen.tsx'
import { zh, type PairScreenKey } from '../src/client/pair-locales.ts'

const t: TranslateNS<'pair.mobile'> = (key, params): string => {
  const template = zh[key as PairScreenKey]
  return Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  )
}

const unused = (): never => { throw new Error('unused by AuthRequiredScreen') }

function mount(reload: () => void = vi.fn()): { reload: () => void } {
  render(<AuthRequiredScreen
    usePanelInfo={unused as never}
    useResource={unused as never}
    useSessionPendingInteraction={unused as never}
    useSessions={unused as never}
    useWorkspaces={unused as never}
    t={t}
    reload={reload}
  />)
  return { reload }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, '__DSH_AUTH_REQUIRED__')
})

describe('authRequiredBootFact', () => {
  it('reads only the exact fact the refused shell carries', () => {
    expect(authRequiredBootFact()).toBe(false)
    Reflect.set(globalThis, '__DSH_AUTH_REQUIRED__', true)
    expect(authRequiredBootFact()).toBe(true)
    Reflect.set(globalThis, '__DSH_AUTH_REQUIRED__', 'yes')
    expect(authRequiredBootFact()).toBe(false)
  })
})

describe('AuthRequiredScreen', () => {
  it('states that the device is not paired and where to create a code', () => {
    mount()

    expect(screen.getByText('登录已失效')).toBeTruthy()
    expect(screen.getByRole('status').textContent)
      .toBe('本设备已不再处于已配对状态。请在电脑端打开 设置 → 通用设置 → 连接手机，生成配对码后在本设备上打开该链接。')
  })

  it('reloads the page when the user asks for it', () => {
    const mounted = mount()

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))

    expect(mounted.reload).toHaveBeenCalledOnce()
  })
})
