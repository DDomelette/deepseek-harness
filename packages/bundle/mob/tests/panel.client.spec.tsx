// @vitest-environment jsdom
/**
 * PairingPanel: the computer's side of the handshake — create a code with a
 * countdown, decide the requests waiting, and list or revoke paired devices.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

// The browser entry's canvas renderer has no jsdom implementation; the QR
// bytes are third-party behavior, so the spec fixes the renderer output.
vi.mock('qrcode/lib/browser.js', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,TESTQR') },
}))

import { PairingPanel } from '../src/client/PairingPanel.tsx'
import type { ConnectPhoneRowInjected } from '../src/client/ConnectPhoneRow.tsx'
import type {
  PairedDeviceView, PairingApi, PairingResult, PairingSessionView, PendingPairingView,
} from '../src/client/pairing-api.ts'
import { zh, type MobileSettingsKey } from '../src/client/locales.ts'

const JOIN_URL = 'http://192.168.1.5:3080/'
const CODE = 'ABCD2345'
const START = Date.parse('2026-09-12T12:00:00.000Z')

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
/** A windowed device row: 30 days from `START`. */
const WINDOWED = {
  id: 'device-1',
  label: '客厅的手机',
  registeredAt: START,
  lastSeenAt: START,
  lifetimeDays: 30,
  expiresAt: START + 30 * DAY_MILLISECONDS,
} as const

const t: TranslateNS<'settings.mobile'> = (key, params): string => {
  const template = zh[key as MobileSettingsKey]
  return Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  )
}

/** One scripted answer for every route the panel calls. */
interface Script {
  open?: PairingResult<PairingSessionView>
  requests?: PairingResult<readonly PendingPairingView[]>
  devices?: PairingResult<readonly PairedDeviceView[]>
  decide?: PairingResult<void>
  revoke?: PairingResult<void>
  setLifetime?: PairingResult<void>
}

/** The panel's client half as spies, so assertions never re-reference a method. */
interface FakeApi {
  readonly api: PairingApi
  readonly open: ReturnType<typeof vi.fn>
  readonly requests: ReturnType<typeof vi.fn>
  readonly decide: ReturnType<typeof vi.fn>
  readonly devices: ReturnType<typeof vi.fn>
  readonly revoke: ReturnType<typeof vi.fn>
  readonly setLifetime: ReturnType<typeof vi.fn>
}

function fakeApi(script: Script = {}): FakeApi {
  const open = vi.fn(async (): Promise<PairingResult<PairingSessionView>> =>
    script.open ?? { ok: true, value: { code: CODE, expiresAt: START + 120_000 } })
  const requests = vi.fn(async (): Promise<PairingResult<readonly PendingPairingView[]>> =>
    script.requests ?? { ok: true, value: [] })
  const decide = vi.fn(async (): Promise<PairingResult<void>> => script.decide ?? { ok: true, value: undefined })
  const devices = vi.fn(async (): Promise<PairingResult<readonly PairedDeviceView[]>> =>
    script.devices ?? { ok: true, value: [] })
  const revoke = vi.fn(async (): Promise<PairingResult<void>> => script.revoke ?? { ok: true, value: undefined })
  const setLifetime = vi.fn(async (): Promise<PairingResult<void>> => script.setLifetime ?? { ok: true, value: undefined })
  return { api: { open, requests, decide, devices, revoke, setLifetime }, open, requests, decide, devices, revoke, setLifetime }
}

const okJoin: ConnectPhoneRowInjected['joinUrl'] = async () => ({ ok: true, value: JOIN_URL })
const refusedJoin = (code: string): ConnectPhoneRowInjected['joinUrl'] =>
  async () => ({ ok: false, error: new RemoteError(code as 'mob/loopback-only', 'refused', {}) })

function mount(options: {
  api?: FakeApi
  canDecide?: boolean
  joinUrl?: ConnectPhoneRowInjected['joinUrl']
} = {}): FakeApi {
  const subject = options.api ?? fakeApi()
  render(<PairingPanel
    t={t}
    api={subject.api}
    canDecide={options.canDecide ?? true}
    joinUrl={options.joinUrl ?? okJoin}
  />)
  return subject
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PairingPanel', () => {
  it('hides every control on a page that may not decide', () => {
    mount({ canDecide: false })

    expect(screen.getByText('这些操作只能在电脑本机上进行。')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText('待确认的请求')).toBeNull()
  })

  it('creates a code and renders the QR, the link, and the countdown', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    const subject = mount()

    fireEvent.click(screen.getByRole('button', { name: '生成配对码' }))
    await vi.advanceTimersByTimeAsync(0)

    expect(screen.getByText(CODE)).toBeTruthy()
    expect(screen.getByRole('img').getAttribute('src')).toContain('data:image/png;base64,TESTQR')
    expect(screen.getByLabelText('加入链接').getAttribute('value'))
      .toBe(`http://192.168.1.5:3080/pair?c=${CODE}`)
    expect(screen.getByText('剩余 120 秒')).toBeTruthy()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(screen.getByText('剩余 119 秒')).toBeTruthy()

    await vi.advanceTimersByTimeAsync(119_000)
    expect(screen.getByText('配对码已过期，请重新生成。')).toBeTruthy()
    expect(screen.queryByText(CODE)).toBeNull()
    expect(subject.requests).toHaveBeenCalled()
  })

  it('decides a waiting request under a label prefilled from the phone agent and editable', async () => {
    const subject = fakeApi({ requests: { ok: true, value: [{
      code: CODE,
      openedAt: START,
      expiresAt: START + 120_000,
      userAgent: 'Mozilla/5.0 (Linux; Android 10; JAD-AL50)',
    }] } })
    mount({ api: subject })

    const label = await waitFor(() => screen.getByLabelText('设备名称'))
    expect(label.getAttribute('value')).toBe('JAD-AL50')
    fireEvent.change(label, { target: { value: '客厅的手机' } })
    fireEvent.click(screen.getByRole('button', { name: '允许' }))

    await waitFor(() => { expect(subject.decide).toHaveBeenCalledWith(CODE, '客厅的手机', true) })
    expect(screen.getByText('待确认的请求')).toBeTruthy()
  })

  it('denies a request and falls back to the dictionary name without an agent', async () => {
    const subject = fakeApi({
      requests: { ok: true, value: [{ code: CODE, openedAt: START, expiresAt: START + 120_000 }] },
    })
    mount({ api: subject })

    const label = await waitFor(() => screen.getByLabelText('设备名称'))
    expect(label.getAttribute('value')).toBe('')
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))

    await waitFor(() => { expect(subject.decide).toHaveBeenCalledWith(CODE, '手机', false) })
  })

  it('lists paired devices with their times and removes a revoked one', async () => {
    const subject = fakeApi({ devices: { ok: true, value: [
      { id: 'device-1', label: '客厅的手机', registeredAt: START, lastSeenAt: START + 60_000 },
      { id: 'device-2', label: 'iPad', registeredAt: START, lastSeenAt: START },
    ] } })
    mount({ api: subject })

    const first = (await waitFor(() => screen.getAllByText('客厅的手机')))[0]!
    const row = first.closest('li')!
    expect(within(row).getByText(/添加于 09-12 20:00/u)).toBeTruthy()
    expect(within(row).getByText(/最近使用 09-12 20:01/u)).toBeTruthy()

    fireEvent.click(within(row).getByRole('button', { name: '吊销' }))
    await waitFor(() => { expect(subject.revoke).toHaveBeenCalledWith('device-1') })
    await waitFor(() => { expect(screen.queryByText('客厅的手机')).toBeNull() })
    expect(screen.getByText('iPad')).toBeTruthy()
  })

  it('reports a failed decision instead of pretending it worked', async () => {
    const subject = fakeApi({ decide: { ok: false, reason: 'failed' }, requests: { ok: true, value: [
      { code: CODE, openedAt: START, expiresAt: START + 120_000, userAgent: 'Android 10; JAD-AL50)' },
    ] } })
    mount({ api: subject })

    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: '允许' })))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('操作失败，请重试。') })
  })

  it('reports a refused or failed code creation, and a join URL refused for another reason', async () => {
    mount({ api: fakeApi({ open: { ok: false, reason: 'failed' } }) })
    fireEvent.click(screen.getByRole('button', { name: '生成配对码' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('操作失败，请重试。') })
    cleanup()

    mount({ api: fakeApi({ open: { ok: false, reason: 'forbidden' } }) })
    fireEvent.click(screen.getByRole('button', { name: '生成配对码' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('当前仅服务回环地址，未开启内网访问；请去掉 --host 127.0.0.1 重新启动 dsh web')
    })
    cleanup()

    mount({ joinUrl: refusedJoin('mob/no-lan-address') })
    fireEvent.click(screen.getByRole('button', { name: '生成配对码' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('操作失败，请重试。') })
  })

  it('shows the LAN-off copy when the join URL reports a loopback-only deployment', async () => {
    mount({ joinUrl: refusedJoin('mob/loopback-only') })

    fireEvent.click(screen.getByRole('button', { name: '生成配对码' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('当前仅服务回环地址，未开启内网访问；请去掉 --host 127.0.0.1 重新启动 dsh web')
    })
  })

  it('keeps working when a decision succeeds but the refresh does not', async () => {
    const subject = fakeApi({ requests: { ok: true, value: [
      { code: CODE, openedAt: START, expiresAt: START + 120_000, userAgent: 'Android 10; JAD-AL50)' },
    ] } })
    mount({ api: subject })
    await waitFor(() => { expect(screen.getByRole('button', { name: '允许' })).toBeTruthy() })

    subject.requests.mockResolvedValue({ ok: false, reason: 'failed' })
    subject.devices.mockResolvedValue({ ok: false, reason: 'failed' })
    fireEvent.click(screen.getByRole('button', { name: '允许' }))

    await waitFor(() => { expect(subject.decide).toHaveBeenCalled() })
    expect(screen.getByText('待确认的请求')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reports a revocation that failed', async () => {
    const subject = fakeApi({
      devices: { ok: true, value: [{ id: 'device-1', label: 'iPad', registeredAt: START, lastSeenAt: START }] },
      revoke: { ok: false, reason: 'failed' },
    })
    mount({ api: subject })

    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: '吊销' })))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('操作失败，请重试。') })
    expect(screen.getByText('iPad')).toBeTruthy()
  })

  it('shows each device window, an expired device, and an unknown legacy entry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(START))
    mount({ api: fakeApi({ devices: { ok: true, value: [
      WINDOWED,
      { id: 'device-2', label: 'iPad', registeredAt: START, lastSeenAt: START, lifetimeDays: 7, expiresAt: START - 1 },
      { id: 'device-3', label: '旧手机', registeredAt: START, lastSeenAt: START },
    ] } }) })

    const first = (await waitFor(() => screen.getAllByText('客厅的手机')))[0]!
    expect(within(first.closest('li')!).getByText(/30 天（剩余 30 天）/u)).toBeTruthy()
    await waitFor(() => { expect(within(screen.getByText('iPad').closest('li')!).getByText('已过期')).toBeTruthy() })
    expect(within(screen.getByText('旧手机').closest('li')!).getByText('—')).toBeTruthy()
  })

  it('re-schedules a device from a preset and from an arbitrary day count', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(START))
    const subject = mount({ api: fakeApi({ devices: { ok: true, value: [WINDOWED] } }) })

    const label = await waitFor(() => screen.getByText('客厅的手机'))
    const row = label.closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: '7 天' }))
    await waitFor(() => { expect(subject.setLifetime).toHaveBeenCalledWith('device-1', 7) })

    const days = within(row).getByLabelText('天数') as HTMLInputElement
    fireEvent.change(days, { target: { value: '45' } })
    fireEvent.click(within(row).getByRole('button', { name: '设为' }))
    await waitFor(() => { expect(subject.setLifetime).toHaveBeenCalledWith('device-1', 45) })

    fireEvent.change(days, { target: { value: '366' } })
    expect((within(row).getByRole('button', { name: '设为' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(days, { target: { value: '0' } })
    expect((within(row).getByRole('button', { name: '设为' }) as HTMLButtonElement).disabled).toBe(true)
    expect(subject.setLifetime).toHaveBeenCalledTimes(2)
  })

  it('states the revoke guidance and reports a refused re-schedule', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(START))
    const subject = mount({ api: fakeApi({
      devices: { ok: true, value: [WINDOWED] },
      setLifetime: { ok: false, reason: 'failed' },
    }) })

    expect(screen.getByText('不再使用的设备请立即吊销；在不受信任的网络上用过之后也建议吊销。')).toBeTruthy()
    expect(screen.getByText('延长后，手机下一次打开页面时生效。')).toBeTruthy()

    const row = (await waitFor(() => screen.getByText('客厅的手机'))).closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: '1 天' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('操作失败，请重试。') })
    expect(subject.setLifetime).toHaveBeenCalledWith('device-1', 1)
    expect(screen.getByText('客厅的手机')).toBeTruthy()
  })

  it('keeps the listed devices when the re-read after a re-schedule fails', async () => {
    const subject = mount({ api: fakeApi({ devices: { ok: true, value: [WINDOWED] } }) })
    const row = (await waitFor(() => screen.getByText('客厅的手机'))).closest('li')!
    subject.devices.mockResolvedValue({ ok: false, reason: 'failed' })

    fireEvent.click(within(row).getByRole('button', { name: '7 天' }))

    await waitFor(() => { expect(subject.setLifetime).toHaveBeenCalledWith('device-1', 7) })
    expect(screen.getByText('客厅的手机')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
