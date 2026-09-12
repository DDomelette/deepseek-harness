// @vitest-environment jsdom
/**
 * ConnectPhoneRow: the General row opens the QR dialog; the dialog loads the
 * join URL, renders the QR image and copyable link, or shows the
 * loopback-unavailable copy.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the mob failure vocabulary, so the scripted refusal names its real code.
import type {} from '../src/types.ts'

// The browser entry's canvas renderer has no jsdom implementation; the QR
// bytes are third-party behavior, so the spec fixes the renderer output.
vi.mock('qrcode/lib/browser.js', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,TESTQR') },
}))

import { ConnectPhoneRow } from '../src/client/ConnectPhoneRow.tsx'
import type { ConnectPhoneRowInjected } from '../src/client/ConnectPhoneRow.tsx'
import { zh, type MobileSettingsKey } from '../src/client/locales.ts'

const JOIN_URL = 'http://192.168.1.5:3080/?token=t'

const t: TranslateNS<'settings.mobile'> = (key, params): string => {
  const template = key in zh ? zh[key as MobileSettingsKey] : key
  return Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  )
}

const unused = (): never => { throw new Error('unused by ConnectPhoneRow') }

function mount(joinUrl: ConnectPhoneRowInjected['joinUrl']): void {
  render(<ConnectPhoneRow
    usePanelInfo={unused as never}
    useResource={unused as never}
    useSessionPendingInteraction={unused as never}
    useSessions={unused as never}
    useWorkspaces={unused as never}
    t={t}
    joinUrl={joinUrl}
  />)
}

const okJoin = (): ConnectPhoneRowInjected['joinUrl'] =>
  vi.fn(async () => ({ ok: true as const, value: JOIN_URL }))

afterEach(cleanup)

describe('ConnectPhoneRow', () => {
  it('renders the row title and keeps the dialog closed until the button is pressed', () => {
    mount(okJoin())
    expect(screen.getByText('连接手机')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the dialog, loads the join URL, and renders the QR image and copyable link', async () => {
    const joinUrl = okJoin()
    mount(joinUrl)
    fireEvent.click(screen.getByRole('button', { name: '显示二维码' }))

    expect(screen.getByRole('dialog', { name: '连接手机' })).toBeTruthy()
    expect(screen.getByText('正在准备加入链接…')).toBeTruthy()

    await waitFor(() => { expect(screen.getByLabelText('加入链接')).toBeTruthy() })
    expect(joinUrl).toHaveBeenCalledOnce()
    const link = screen.getByLabelText('加入链接') as HTMLInputElement
    expect(link.value).toBe(JOIN_URL)
    const image = screen.getByRole('img', { name: '连接手机' }) as HTMLImageElement
    expect(image.src.startsWith('data:image/')).toBe(true)

    // Focusing the link field selects it for copying.
    const select = vi.spyOn(HTMLInputElement.prototype, 'select')
    fireEvent.focus(link)
    expect(select).toHaveBeenCalledOnce()
  })

  it('shows the loopback-unavailable copy when the Host refuses', async () => {
    mount(vi.fn(async () => ({
      ok: false as const,
      error: new RemoteError('mob/loopback-only', 'loopback-only deployment has no LAN join URL', {}),
    })))
    fireEvent.click(screen.getByRole('button', { name: '显示二维码' }))

    await waitFor(() => { expect(screen.getByText('当前未开启内网访问，请用 dsh mob 启动')).toBeTruthy() })
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('names an all-interfaces bind that derived no address, not a disabled LAN', async () => {
    mount(vi.fn(async () => ({
      ok: false as const,
      error: new RemoteError('mob/no-lan-address', 'no interface yielded a LAN address for the join URL', {}),
    })))
    fireEvent.click(screen.getByRole('button', { name: '显示二维码' }))

    await waitFor(() => { expect(screen.getByText('未找到局域网地址，请检查本机网络连接')).toBeTruthy() })
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('shows the load-failure copy on a non-loopback Remote failure', async () => {
    mount(vi.fn(async () => ({
      ok: false as const,
      error: new RemoteError('gateway/internal', 'gateway folded an unexpected exception', {}),
    })))
    fireEvent.click(screen.getByRole('button', { name: '显示二维码' }))

    await waitFor(() => { expect(screen.getByText('加入链接加载失败')).toBeTruthy() })
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('shows the load-failure copy instead of hanging when the join read rejects', async () => {
    mount(vi.fn(async (): Promise<never> => { throw new Error('connection dropped') }))
    fireEvent.click(screen.getByRole('button', { name: '显示二维码' }))

    await waitFor(() => { expect(screen.getByText('加入链接加载失败')).toBeTruthy() })
    expect(screen.queryByText('正在准备加入链接…')).toBeNull()
  })

  it('closes on Escape and reloads the URL on reopen', async () => {
    const joinUrl = okJoin()
    mount(joinUrl)
    fireEvent.click(screen.getByRole('button', { name: '显示二维码' }))
    await waitFor(() => { expect(screen.getByLabelText('加入链接')).toBeTruthy() })

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '显示二维码' }))
    expect(screen.getByText('正在准备加入链接…')).toBeTruthy()
    await waitFor(() => { expect(screen.getByLabelText('加入链接')).toBeTruthy() })
    expect(joinUrl).toHaveBeenCalledTimes(2)
  })

  it('drops a late answer after the dialog closes mid-load', async () => {
    let release: (value: { ok: true; value: string }) => void
    const joinUrl = vi.fn(() => new Promise<{ ok: true; value: string }>((resolve) => { release = resolve }))
    mount(joinUrl)
    fireEvent.click(screen.getByRole('button', { name: '显示二维码' }))
    fireEvent.keyDown(document, { key: 'Escape' })

    release!({ ok: true, value: JOIN_URL })
    // The cancelled effect never republishes: nothing reopens and no link field appears.
    await waitFor(() => { expect(joinUrl).toHaveBeenCalledOnce() })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('drops a late rejection after the dialog closes mid-load', async () => {
    let reject: (error: Error) => void
    const joinUrl = vi.fn(() => new Promise<never>((_resolve, rejectPromise) => { reject = rejectPromise }))
    mount(joinUrl)
    fireEvent.click(screen.getByRole('button', { name: '显示二维码' }))
    fireEvent.keyDown(document, { key: 'Escape' })

    reject!(new Error('connection dropped'))
    // The catch arm still feeds the cancelled effect: no failure copy, no unhandled rejection.
    await waitFor(() => { expect(joinUrl).toHaveBeenCalledOnce() })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
