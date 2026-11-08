// @vitest-environment jsdom
/**
 * MobileSection: the Connect-phone settings page. It states the address this
 * page runs on and whether a phone can reach the deployment, edits the saved
 * bind policy, and hands every pairing operation to the same panel the row
 * used to open in a dialog.
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

import { MobileSection } from '../src/client/MobileSection.tsx'
import type { MobileSectionInjected } from '../src/client/MobileSection.tsx'
import type { MobileBindSettings } from '../src/client/bind-settings.ts'
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

const unused = (): never => { throw new Error('unused by MobileSection') }

/** The selector hook the renderer binds for the injected `bind` snapshot. */
function bindHook<T>(snapshot: T): <S>(selector: (value: T) => S) => S {
  return <S,>(selector: (value: T) => S): S => selector(snapshot)
}

const api: PairingApi = {
  open: async () => ({ ok: true, value: { code: 'ABCD2345', expiresAt: Date.now() + 120_000 } }),
  requests: async () => ({ ok: true, value: [] }),
  decide: async () => ({ ok: true, value: undefined }),
  devices: async () => ({ ok: true, value: [] }),
  revoke: async () => ({ ok: true, value: undefined }),
  restore: async () => ({ ok: true, value: undefined }),
  purge: async () => ({ ok: true, value: undefined }),
  setLifetime: async () => ({ ok: true, value: undefined }),
  rename: async () => ({ ok: true, value: undefined }),
}

/** Render the page with the saved policy the bench supplies. */
function mount(saved: MobileBindSettings = { bindMode: 'loopback', bindHost: '' }, face: Partial<MobileSectionInjected> = {}): {
  saveBind: ReturnType<typeof vi.fn>
} {
  const saveBind = vi.fn(async () => true)
  const snapshot = {
    status: 'ready' as const,
    value: saved,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host' as const,
  }
  render(<MobileSection
    close={() => {}}
    usePanelInfo={unused as never}
    useResource={unused as never}
    useSessionStatus={unused as never}
    useSessionRetainInfo={unused as never}
    useSessions={unused as never}
    useWorkspaces={unused as never}
    useBind={bindHook(snapshot)}
    t={t}
    joinUrl={async () => ({ ok: true, value: JOIN_URL })}
    api={api}
    saveBind={saveBind}
    {...face}
  />)
  return { saveBind }
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
    const address = screen.getByLabelText('IP 地址')
    expect(address).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('绑定方式'), { target: { value: 'auto' } })
    expect(screen.getByLabelText('IP 地址')).toHaveProperty('disabled', false)
    fireEvent.change(screen.getByLabelText('绑定方式'), { target: { value: 'fixed' } })
    expect(screen.getByLabelText('IP 地址')).toHaveProperty('disabled', false)
    expect(screen.getByRole('button', { name: '生成配对码' })).toBeTruthy()
  })

  it('saves the address typed in automatic mode as its fallback', async () => {
    const { saveBind } = mount()
    fireEvent.change(screen.getByLabelText('绑定方式'), { target: { value: 'auto' } })
    fireEvent.change(screen.getByLabelText('IP 地址'), { target: { value: '192.168.1.9' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(saveBind).toHaveBeenCalledWith({ bindMode: 'auto', bindHost: '192.168.1.9' }) })
  })

  it('creates a pairing code for the phone', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '生成配对码' }))
    await waitFor(() => { expect(screen.getByText('ABCD2345')).toBeTruthy() })
    expect(screen.getByRole('img')).toBeTruthy()
  })

  it('says a phone cannot connect when the Host refuses the join URL, and points at the address block', async () => {
    mount(undefined, {
      joinUrl: async () => ({
        ok: false as const,
        error: new RemoteError('mob/no-advertised-origin', 'the deployment declares no reachable origin', {}),
      }),
    })
    expect(await screen.findByText(zh['access.unreachable'])).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '生成配对码' }))
    await waitFor(() => { expect(screen.getByText(zh['dialog.unavailable'])).toBeTruthy() })
  })

  it('saves a fixed address through the injected write path', async () => {
    const { saveBind } = mount()
    fireEvent.change(screen.getByLabelText('绑定方式'), { target: { value: 'fixed' } })
    const field = screen.getByLabelText('IP 地址')
    expect(screen.getByRole('button', { name: '保存' })).toHaveProperty('disabled', true)

    fireEvent.change(field, { target: { value: ' 192.168.1.5 ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => { expect(saveBind).toHaveBeenCalledWith({ bindMode: 'fixed', bindHost: '192.168.1.5' }) })
    expect(await screen.findByText(zh['access.saved'])).toBeTruthy()
  })

  it('reports a refused save and keeps the edit', async () => {
    const saveBind = vi.fn(async () => false)
    mount({ bindMode: 'auto', bindHost: '' }, { saveBind })
    fireEvent.change(screen.getByLabelText('绑定方式'), { target: { value: 'fixed' } })
    fireEvent.change(screen.getByLabelText('IP 地址'), { target: { value: '10.0.0.7' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText(zh['access.failed'])).toBeTruthy()
    expect(screen.getByLabelText('IP 地址')).toHaveProperty('value', '10.0.0.7')
  })

  it('keeps the address block visible but read-only when the Host exposes no bind policy', async () => {
    const snapshot = {
      status: 'unavailable' as const,
      value: undefined,
      base: undefined,
      user: undefined,
      revision: undefined,
      writable: false,
      mode: 'host' as const,
    }
    render(<MobileSection
      close={() => {}}
      usePanelInfo={unused as never}
      useResource={unused as never}
      useSessionStatus={unused as never}
      useSessionRetainInfo={unused as never}
      useSessions={unused as never}
      useWorkspaces={unused as never}
      useBind={bindHook(snapshot)}
      t={t}
      joinUrl={async () => ({ ok: true, value: JOIN_URL })}
      api={api}
      saveBind={async () => true}
    />)
    // The block stays: a remote page still needs to know which address it is on
    // and why it cannot change the policy from there.
    expect(screen.getByRole('heading', { name: '访问地址' })).toBeTruthy()
    expect(screen.getByText(globalThis.location.host)).toBeTruthy()
    expect(screen.getByText(zh['access.readOnly'])).toBeTruthy()
    expect(screen.queryByLabelText('绑定方式')).toBeNull()
    expect(screen.queryByLabelText('IP 地址')).toBeNull()
    expect(await screen.findByRole('button', { name: '生成配对码' })).toBeTruthy()
  })

  it('keeps the code and QR when an inline rename cancels on Escape', async () => {
    const rename = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const now = Date.now()
    mount(undefined, {
      api: {
        ...api,
        devices: async () => ({ ok: true, value: [
          { id: 'device-1', label: '客厅的手机', registeredAt: now, lastSeenAt: now },
        ] }),
        rename,
      },
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
