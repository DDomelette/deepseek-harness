// @vitest-environment jsdom
/**
 * MobileSection: the Connect-phone settings page. It states the address this
 * page runs on and whether a phone can reach the deployment, edits the saved
 * bind policy through the operator-gated `/pair/bind` route, and hands every
 * pairing operation to the pairing panel.
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

import { MobileSection, type MobileSectionInjected } from '../src/client/MobileSection.tsx'
import type { MobileBindSettings } from '../src/client/bind-settings.ts'
import type { PairingApi, PairingResult } from '../src/client/pairing-api.ts'
import { zh, type MobileSettingsKey } from '../src/client/locales.ts'

const JOIN_URL = 'http://192.168.1.5:3080/'

const t: TranslateNS<'settings.mobile'> = (key, params): string => {
  const template = key in zh ? zh[key as MobileSettingsKey] : key
  return Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  )
}

const unused = (): never => { throw new Error('unused by MobileSection') }

/** The pairing routes with a settled device list, plus one scripted bind answer. */
function apiWith(
  bind: PairingResult<MobileBindSettings>,
  overrides: Partial<PairingApi> = {},
): PairingApi {
  return {
    open: async () => ({ ok: true, value: { code: 'ABCD2345', expiresAt: Date.now() + 120_000 } }),
    requests: async () => ({ ok: true, value: [] }),
    decide: async () => ({ ok: true, value: undefined }),
    devices: async () => ({ ok: true, value: [] }),
    revoke: async () => ({ ok: true, value: undefined }),
    restore: async () => ({ ok: true, value: undefined }),
    purge: async () => ({ ok: true, value: undefined }),
    setLifetime: async () => ({ ok: true, value: undefined }),
    rename: async () => ({ ok: true, value: undefined }),
    bind: async () => bind,
    saveBind: async policy => ({ ok: true, value: policy }),
    ...overrides,
  }
}

/** Render the page with one scripted bind answer. */
function mount(
  bind: PairingResult<MobileBindSettings> = { ok: true, value: { bindMode: 'loopback', bindHost: '' } },
  face: Partial<MobileSectionInjected> = {},
  overrides: Partial<PairingApi> = {},
): { api: PairingApi } {
  const api = apiWith(bind, overrides)
  render(<MobileSection
    close={() => {}}
    usePanelInfo={unused as never}
    useResource={unused as never}
    useSessionStatus={unused as never}
    useSessionRetainInfo={unused as never}
    useSessions={unused as never}
    useWorkspaces={unused as never}
    useRemoteAccess={unused as never}
    useSessionAccess={unused as never}
    useContextMenu={unused as never}
    useWorkspaceAccess={unused as never}
    t={t}
    joinUrl={async () => ({ ok: true, value: JOIN_URL })}
    api={api}
    {...face}
  />)
  return { api }
}

afterEach(cleanup)

describe('MobileSection', () => {
  it('states this page’s address, the phone-reachable origin, and the address field in every mode', async () => {
    mount()
    expect(screen.getByRole('heading', { name: '连接手机' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '访问地址' })).toBeTruthy()
    expect(screen.getByText(globalThis.location.host)).toBeTruthy()
    expect(await screen.findByText(`手机可打开 ${JOIN_URL}`)).toBeTruthy()

    // The address field stays on the page in every mode; loopback mode is the
    // one mode that does not read it, so it is shown disabled rather than gone.
    expect(screen.getByLabelText('IP 地址')).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('绑定方式'), { target: { value: 'auto' } })
    expect(screen.getByLabelText('IP 地址')).toHaveProperty('disabled', false)
    fireEvent.change(screen.getByLabelText('绑定方式'), { target: { value: 'fixed' } })
    expect(screen.getByLabelText('IP 地址')).toHaveProperty('disabled', false)
    // A new address or port strands the paired cookies, so the page says so.
    expect(screen.getByText(zh['access.rebind'])).toBeTruthy()
    expect(await screen.findByRole('button', { name: '生成配对码' })).toBeTruthy()
  })

  it('saves the address typed in automatic mode as its fallback', async () => {
    const { api } = mount({ ok: true, value: { bindMode: 'auto', bindHost: '' } })
    const saveBind = vi.spyOn(api, 'saveBind')
    await screen.findByLabelText('绑定方式')
    fireEvent.change(screen.getByLabelText('IP 地址'), { target: { value: ' 192.168.1.9 ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(saveBind).toHaveBeenCalledWith({ bindMode: 'auto', bindHost: '192.168.1.9' }) })
    expect(await screen.findByText(zh['access.saved'])).toBeTruthy()
  })

  it('saves a fixed address and requires one before saving', async () => {
    const { api } = mount()
    const saveBind = vi.spyOn(api, 'saveBind')
    await screen.findByLabelText('绑定方式')
    fireEvent.change(screen.getByLabelText('绑定方式'), { target: { value: 'fixed' } })
    expect(screen.getByRole('button', { name: '保存' })).toHaveProperty('disabled', true)

    fireEvent.change(screen.getByLabelText('IP 地址'), { target: { value: '192.168.1.5' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(saveBind).toHaveBeenCalledWith({ bindMode: 'fixed', bindHost: '192.168.1.5' }) })
    expect(await screen.findByText(zh['access.saved'])).toBeTruthy()
  })

  it('reports a refused save and keeps the edit', async () => {
    mount({ ok: true, value: { bindMode: 'auto', bindHost: '' } }, {}, {
      saveBind: async () => ({ ok: false, reason: 'failed' }),
    })
    await screen.findByLabelText('绑定方式')
    fireEvent.change(screen.getByLabelText('绑定方式'), { target: { value: 'fixed' } })
    fireEvent.change(screen.getByLabelText('IP 地址'), { target: { value: '10.0.0.7' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText(zh['access.failed'])).toBeTruthy()
    expect(screen.getByLabelText('IP 地址')).toHaveProperty('value', '10.0.0.7')
  })

  it('keeps the address block visible but read-only for a paired phone', async () => {
    mount({ ok: false, reason: 'forbidden' })
    // A phone still learns which address it is on and why it cannot change the
    // deployment-wide policy from there; the controls simply are not offered.
    expect(screen.getByRole('heading', { name: '访问地址' })).toBeTruthy()
    expect(screen.getByText(globalThis.location.host)).toBeTruthy()
    expect(await screen.findByText(zh['access.readOnly'])).toBeTruthy()
    expect(screen.queryByLabelText('绑定方式')).toBeNull()
    expect(screen.queryByLabelText('IP 地址')).toBeNull()
    expect(await screen.findByRole('button', { name: '生成配对码' })).toBeTruthy()
  })

  it('offers a retry when the policy read fails for a transient reason', async () => {
    const bind = vi.fn()
      .mockResolvedValueOnce({ ok: false as const, reason: 'failed' as const })
      .mockResolvedValue({ ok: true as const, value: { bindMode: 'auto' as const, bindHost: '' } })
    mount(undefined, {}, { bind })
    expect(await screen.findByText(zh['panel.loadFailed'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => { expect(screen.getByLabelText('绑定方式')).toBeTruthy() })
    expect(bind).toHaveBeenCalledTimes(2)
  })

  it('creates a pairing code for the phone', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '生成配对码' }))
    await waitFor(() => { expect(screen.getByText('ABCD2345')).toBeTruthy() })
    expect(screen.getByRole('img')).toBeTruthy()
  })

  it('says a phone cannot connect when the Host refuses the join URL', async () => {
    mount(undefined, {
      joinUrl: async () => ({
        ok: false as const,
        error: new RemoteError('mob/no-advertised-origin', 'the deployment declares no reachable origin', {}),
      }),
    })
    expect(await screen.findByText(zh['access.unreachable'])).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: '生成配对码' }))
    await waitFor(() => { expect(screen.getByText(zh['dialog.unavailable'])).toBeTruthy() })
  })

  it('keeps the code and QR when an inline rename cancels on Escape', async () => {
    const rename = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const now = Date.now()
    mount(undefined, {}, {
      devices: async () => ({
        ok: true,
        value: [{ id: 'device-1', label: '客厅的手机', registeredAt: now, lastSeenAt: now }],
      }),
      rename,
    })
    fireEvent.click(await screen.findByRole('button', { name: '生成配对码' }))
    await waitFor(() => { expect(screen.getByText('客厅的手机')).toBeTruthy() })

    const row = screen.getByText('客厅的手机').closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: '重命名' }))
    fireEvent.keyDown(within(row).getByLabelText('重命名'), { key: 'Escape' })

    await waitFor(() => { expect(within(row).queryByRole('textbox')).toBeNull() })
    expect(screen.getByText('ABCD2345')).toBeTruthy()
    expect(screen.getByRole('img')).toBeTruthy()
    expect(rename).not.toHaveBeenCalled()
  })
})
