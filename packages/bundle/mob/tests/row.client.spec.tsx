// @vitest-environment jsdom
/**
 * ConnectPhoneRow: the General row opens the pairing panel, which owns every
 * pairing operation and the copy that explains an unavailable one.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
import type { PairingApi } from '../src/client/pairing-api.ts'
import { zh, type MobileSettingsKey } from '../src/client/locales.ts'

const JOIN_URL = 'http://192.168.1.5:3080/'

const t: TranslateNS<'settings.mobile'> = (key, params): string => {
  const template = key in zh ? zh[key as MobileSettingsKey] : key
  return Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  )
}

const unused = (): never => { throw new Error('unused by ConnectPhoneRow') }

const api: PairingApi = {
  open: async () => ({ ok: true, value: { code: 'ABCD2345', expiresAt: Date.now() + 120_000 } }),
  requests: async () => ({ ok: true, value: [] }),
  decide: async () => ({ ok: true, value: undefined }),
  devices: async () => ({ ok: true, value: [] }),
  revoke: async () => ({ ok: true, value: undefined }),
}

function mount(face: Partial<ConnectPhoneRowInjected> = {}): void {
  render(<ConnectPhoneRow
    usePanelInfo={unused as never}
    useResource={unused as never}
    useSessionPendingInteraction={unused as never}
    useSessions={unused as never}
    useWorkspaces={unused as never}
    t={t}
    joinUrl={async () => ({ ok: true, value: JOIN_URL })}
    canDecide
    api={api}
    {...face}
  />)
}

afterEach(cleanup)

describe('ConnectPhoneRow', () => {
  it('renders the row title and keeps the panel closed until the button is pressed', () => {
    mount()
    expect(screen.getByText('连接手机')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: '生成配对码' })).toBeNull()
  })

  it('opens the pairing panel, which creates a code for the phone', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: '显示二维码' }))

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '生成配对码' }))
    await waitFor(() => { expect(within(dialog).getByText('ABCD2345')).toBeTruthy() })
    expect(within(dialog).getByRole('img')).toBeTruthy()
  })

  it('shows the loopback-unavailable copy when the Host refuses the join URL', async () => {
    mount({
      joinUrl: async () => ({
        ok: false as const,
        error: new RemoteError('mob/loopback-only', 'loopback-only deployment has no LAN join URL', {}),
      }),
    })
    fireEvent.click(screen.getByRole('button', { name: '显示二维码' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '生成配对码' }))

    await waitFor(() => {
      expect(screen.getByText('当前未开启内网访问，请用 dsh web --host 0.0.0.0 --allow-lan 启动')).toBeTruthy()
    })
  })

  it('closes the panel again', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: '显示二维码' }))
    expect(screen.getByRole('dialog')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })
})
