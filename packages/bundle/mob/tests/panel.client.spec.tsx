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
const START = new Date(2026, 8, 12, 20, 0).getTime()

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
  restore?: PairingResult<void>
  purge?: PairingResult<void>
  rename?: PairingResult<void>
  setLifetime?: PairingResult<void>
  /** Holds the decision answer open, for a click that lands while one is in flight. */
  decideGate?: Promise<void>
  /** Holds the revoke answer open, for a click that lands while one is in flight. */
  revokeGate?: Promise<void>
}

/** The panel's client half as spies, so assertions never re-reference a method. */
interface FakeApi {
  readonly api: PairingApi
  readonly open: ReturnType<typeof vi.fn>
  readonly requests: ReturnType<typeof vi.fn>
  readonly decide: ReturnType<typeof vi.fn>
  readonly devices: ReturnType<typeof vi.fn>
  readonly revoke: ReturnType<typeof vi.fn>
  readonly restore: ReturnType<typeof vi.fn>
  readonly purge: ReturnType<typeof vi.fn>
  readonly rename: ReturnType<typeof vi.fn>
  readonly setLifetime: ReturnType<typeof vi.fn>
}

function fakeApi(script: Script = {}): FakeApi {
  const open = vi.fn(async (): Promise<PairingResult<PairingSessionView>> =>
    script.open ?? { ok: true, value: { code: CODE, expiresAt: START + 120_000 } })
  const requests = vi.fn(async (): Promise<PairingResult<readonly PendingPairingView[]>> =>
    script.requests ?? { ok: true, value: [] })
  const decide = vi.fn(async (): Promise<PairingResult<void>> => {
    await script.decideGate
    return script.decide ?? { ok: true, value: undefined }
  })
  const devices = vi.fn(async (): Promise<PairingResult<readonly PairedDeviceView[]>> =>
    script.devices ?? { ok: true, value: [] })
  const revoke = vi.fn(async (): Promise<PairingResult<void>> => {
    await script.revokeGate
    return script.revoke ?? { ok: true, value: undefined }
  })
  const restore = vi.fn(async (): Promise<PairingResult<void>> => script.restore ?? { ok: true, value: undefined })
  const purge = vi.fn(async (): Promise<PairingResult<void>> => script.purge ?? { ok: true, value: undefined })
  const rename = vi.fn(async (): Promise<PairingResult<void>> => script.rename ?? { ok: true, value: undefined })
  const setLifetime = vi.fn(async (): Promise<PairingResult<void>> => script.setLifetime ?? { ok: true, value: undefined })
  return {
    api: { open, requests, decide, devices, revoke, restore, purge, rename, setLifetime },
    open, requests, decide, devices, revoke, restore, purge, rename, setLifetime,
  }
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

  it('copies the join link and confirms for two seconds, selecting the field without a clipboard', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(START))
    mount()

    fireEvent.click(screen.getByRole('button', { name: '生成配对码' }))
    await vi.advanceTimersByTimeAsync(0)

    // jsdom has no Clipboard API: the fallback selects the URL field.
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getByRole('button', { name: '已复制' })).toBeTruthy()

    await vi.advanceTimersByTimeAsync(2_000)
    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
  })

  it('writes the join link to the clipboard when the browser offers one', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(START))
      mount()

      fireEvent.click(screen.getByRole('button', { name: '生成配对码' }))
      await vi.advanceTimersByTimeAsync(0)
      fireEvent.click(screen.getByRole('button', { name: '复制' }))
      await vi.advanceTimersByTimeAsync(0)

      expect(writeText).toHaveBeenCalledWith(`http://192.168.1.5:3080/pair?c=${CODE}`)
      expect(screen.getByRole('button', { name: '已复制' })).toBeTruthy()
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
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

  it('lists paired devices with their times and moves a revoked one to the recycle bin', async () => {
    const active = [
      { id: 'device-1', label: '客厅的手机', registeredAt: START, lastSeenAt: START + 60_000 },
      { id: 'device-2', label: 'iPad', registeredAt: START, lastSeenAt: START },
    ]
    const subject = fakeApi({ devices: { ok: true, value: active } })
    mount({ api: subject })

    const first = (await waitFor(() => screen.getAllByText('客厅的手机')))[0]!
    const row = first.closest('li')!
    expect(within(row).getByText(/添加于 09-12 20:00/u)).toBeTruthy()
    expect(within(row).getByText(/最近使用 09-12 20:01/u)).toBeTruthy()
    expect(screen.queryByText('回收站')).toBeNull()

    subject.devices.mockResolvedValue({ ok: true, value: [
      { ...active[0]!, revokedAt: START + 120_000 },
      active[1]!,
    ] })
    fireEvent.click(within(row).getByRole('button', { name: '吊销凭证' }))
    await waitFor(() => { expect(subject.revoke).toHaveBeenCalledWith('device-1') })

    // The binned device leaves the paired list and appears in the recycle bin.
    const binHeading = await waitFor(() => screen.getByText('回收站'))
    const binItem = screen.getByText('客厅的手机').closest('li')!
    expect(within(binItem).getByText('吊销于 09-12 20:02')).toBeTruthy()
    expect(binHeading.closest('section')).toBe(binItem.closest('section'))
    expect(screen.getByText('iPad').closest('li')).not.toBe(binItem)
  })

  it('restores a binned device and purges one only after a confirmation', async () => {
    const binned = { id: 'device-1', label: '旧手机', registeredAt: START, lastSeenAt: START, revokedAt: START }
    const subject = fakeApi({ devices: { ok: true, value: [binned] } })
    mount({ api: subject })

    const item = (await waitFor(() => screen.getByText('旧手机'))).closest('li')!
    expect(screen.getByText('回收站中的设备无法访问；恢复后，其 cookie 在窗口未结束时重新生效。')).toBeTruthy()

    // Restore returns the row to the paired list.
    subject.devices.mockResolvedValue({ ok: true, value: [
      { id: 'device-1', label: '旧手机', registeredAt: START, lastSeenAt: START },
    ] })
    fireEvent.click(within(item).getByRole('button', { name: '恢复' }))
    await waitFor(() => { expect(subject.restore).toHaveBeenCalledWith('device-1') })
    await waitFor(() => { expect(screen.queryByText('回收站')).toBeNull() })

    // Purge asks for confirmation and forgets the device for good.
    subject.devices.mockResolvedValue({ ok: true, value: [binned] })
    fireEvent.click(screen.getByRole('button', { name: '吊销凭证' }))
    await waitFor(() => screen.getByText('回收站'))
    const binnedItem = screen.getByText('旧手机').closest('li')!
    fireEvent.click(within(binnedItem).getByRole('button', { name: '彻底删除' }))
    expect(subject.purge).not.toHaveBeenCalled()
    fireEvent.click(within(binnedItem).getByRole('button', { name: '取消' }))
    expect(within(binnedItem).getByRole('button', { name: '彻底删除' })).toBeTruthy()

    fireEvent.click(within(binnedItem).getByRole('button', { name: '彻底删除' }))
    fireEvent.click(within(binnedItem).getByRole('button', { name: '确认彻底删除' }))
    await waitFor(() => { expect(subject.purge).toHaveBeenCalledWith('device-1') })
  })

  it('drops a second click on a device action while the first one is in flight', async () => {
    const active = [{ id: 'device-1', label: '客厅的手机', registeredAt: START, lastSeenAt: START }]
    const gate: PromiseWithResolvers<void> = Promise.withResolvers()
    const subject = fakeApi({ devices: { ok: true, value: active }, revokeGate: gate.promise })
    mount({ api: subject })

    const row = (await waitFor(() => screen.getByText('客厅的手机'))).closest('li')!
    const revoke = within(row).getByRole('button', { name: '吊销凭证' })
    fireEvent.click(revoke)
    fireEvent.click(revoke)
    await waitFor(() => { expect(subject.revoke).toHaveBeenCalledTimes(1) })

    gate.resolve()
    await waitFor(() => { expect(subject.devices).toHaveBeenCalledTimes(2) })
    expect(subject.revoke).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reports a failed restore or purge instead of pretending it worked', async () => {
    const binned = { id: 'device-1', label: '旧手机', registeredAt: START, lastSeenAt: START, revokedAt: START }
    const subject = fakeApi({
      devices: { ok: true, value: [binned] },
      restore: { ok: false, reason: 'failed' },
      purge: { ok: false, reason: 'failed' },
    })
    mount({ api: subject })

    const item = (await waitFor(() => screen.getByText('旧手机'))).closest('li')!
    fireEvent.click(within(item).getByRole('button', { name: '恢复' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('操作失败，请重试。') })

    fireEvent.click(within(item).getByRole('button', { name: '彻底删除' }))
    fireEvent.click(within(item).getByRole('button', { name: '确认彻底删除' }))
    await waitFor(() => { expect(subject.purge).toHaveBeenCalledWith('device-1') })
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('操作失败，请重试。') })
    expect(screen.getByText('旧手机')).toBeTruthy()
  })

  it('reports a failed decision instead of pretending it worked', async () => {
    const subject = fakeApi({ decide: { ok: false, reason: 'failed' }, requests: { ok: true, value: [
      { code: CODE, openedAt: START, expiresAt: START + 120_000, userAgent: 'Android 10; JAD-AL50)' },
    ] } })
    mount({ api: subject })

    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: '允许' })))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('操作失败，请重试。') })
  })

  it('drops a second click while one decision is still in flight', async () => {
    const gate: PromiseWithResolvers<void> = Promise.withResolvers()
    const subject = fakeApi({
      decideGate: gate.promise,
      requests: { ok: true, value: [
        { code: CODE, openedAt: START, expiresAt: START + 120_000, userAgent: 'Android 10; JAD-AL50)' },
      ] },
    })
    mount({ api: subject })

    // A double click sends one decision: the Host refuses the second one, and
    // reporting that refusal would read as a failure the operator never caused.
    const allow = await waitFor(() => screen.getByRole('button', { name: '允许' }))
    fireEvent.click(allow)
    fireEvent.click(allow)
    await waitFor(() => { expect(subject.decide).toHaveBeenCalledTimes(1) })

    gate.resolve()
    await waitFor(() => { expect(subject.requests).toHaveBeenCalledTimes(2) })
    expect(subject.decide).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('clears a failure notice once a later action succeeds', async () => {
    const subject = fakeApi({ decide: { ok: false, reason: 'failed' }, requests: { ok: true, value: [
      { code: CODE, openedAt: START, expiresAt: START + 120_000, userAgent: 'Android 10; JAD-AL50)' },
    ] } })
    mount({ api: subject })

    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: '允许' })))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('操作失败，请重试。') })

    subject.decide.mockResolvedValue({ ok: true, value: undefined })
    fireEvent.click(screen.getByRole('button', { name: '允许' }))
    await waitFor(() => { expect(subject.decide).toHaveBeenCalledTimes(2) })
    expect(screen.queryByRole('alert')).toBeNull()
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

    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: '吊销凭证' })))
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
      { id: 'device-4', label: '旧平板', registeredAt: START, lastSeenAt: START, lifetimeDays: 45, expiresAt: START + 45 * 86_400_000 },
    ] } }) })

    const first = (await waitFor(() => screen.getAllByText('客厅的手机')))[0]!
    expect(within(first.closest('li')!).getByText(/30 天（剩余 30 天）/u)).toBeTruthy()
    await waitFor(() => { expect(within(screen.getByText('iPad').closest('li')!).getByText('已过期')).toBeTruthy() })
    // A legacy entry shows the unknown marker twice: its chip and its selector.
    expect(within(screen.getByText('旧手机').closest('li')!).getAllByText('—')).toHaveLength(2)
    // A window no preset names still shows its day count on the selector.
    expect(within(screen.getByText('旧平板').closest('li')!).getByRole('button', { name: '45 天' })).toBeTruthy()
  })

  it('reports the credential the phone holds, not only the window the operator set', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(START))
    mount({ api: fakeApi({ devices: { ok: true, value: [
      { ...WINDOWED, credentialExpiresAt: START + 30 * DAY_MILLISECONDS },
      { ...WINDOWED, id: 'device-2', label: '新手机', credentialExpiresAt: START + 2 * DAY_MILLISECONDS },
      { ...WINDOWED, id: 'device-3', label: '掉线的手机', credentialExpiresAt: START - 1 },
    ] } }) })

    const aligned = (await waitFor(() => screen.getAllByText('客厅的手机')))[0]!.closest('li')!
    expect(within(aligned).getByText(/30 天（剩余 30 天）/u)).toBeTruthy()
    // An extended window the phone has not picked up yet names the shorter credential.
    expect(within(screen.getByText('新手机').closest('li')!).getByText(/30 天（手机凭证剩余 2 天）/u)).toBeTruthy()
    // A credential past its own expiry is dead whatever window the row still carries.
    expect(within(screen.getByText('掉线的手机').closest('li')!).getByText('凭证已失效，需重新配对')).toBeTruthy()
  })

  it('shows the MAC address a device resolved at approval', async () => {
    mount({ api: fakeApi({ devices: { ok: true, value: [
      { ...WINDOWED, macAddress: '48:a7:3c:f1:87:18' },
    ] } }) })

    const row = (await waitFor(() => screen.getByText('客厅的手机'))).closest('li')!
    expect(within(row).getByText(/48:a7:3c:f1:87:18/u)).toBeTruthy()
  })

  it('renames a device inline, committing on Enter and cancelling on Escape', async () => {
    const subject = mount({ api: fakeApi({ devices: { ok: true, value: [WINDOWED] } }) })
    const row = (await waitFor(() => screen.getByText('客厅的手机'))).closest('li')!

    fireEvent.click(within(row).getByRole('button', { name: '重命名' }))
    const input = within(row).getByLabelText('重命名')
    fireEvent.change(input, { target: { value: '  书房的手机  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => { expect(subject.rename).toHaveBeenCalledWith('device-1', '书房的手机') })

    // Escape closes the input without a call; an unchanged draft commits nothing.
    fireEvent.click(within(row).getByRole('button', { name: '重命名' }))
    const reopened = within(row).getByLabelText('重命名')
    fireEvent.change(reopened, { target: { value: '客厅的手机' } })
    fireEvent.keyDown(reopened, { key: 'Escape' })
    expect(within(row).queryByRole('textbox')).toBeNull()

    // Losing focus commits the draft the same way Enter does.
    fireEvent.click(within(row).getByRole('button', { name: '重命名' }))
    const blurred = within(row).getByLabelText('重命名')
    fireEvent.change(blurred, { target: { value: '卧室的手机' } })
    fireEvent.blur(blurred)
    await waitFor(() => { expect(subject.rename).toHaveBeenCalledWith('device-1', '卧室的手机') })

    fireEvent.click(within(row).getByRole('button', { name: '重命名' }))
    fireEvent.keyDown(within(row).getByLabelText('重命名'), { key: 'Enter' })
    await waitFor(() => { expect(screen.getByText('客厅的手机')).toBeTruthy() })
    expect(subject.rename).toHaveBeenCalledTimes(2)
  })

  it('consumes the Escape that cancels an inline rename', async () => {
    const subject = mount({ api: fakeApi({ devices: { ok: true, value: [WINDOWED] } }) })

    const label = await waitFor(() => screen.getByText('客厅的手机'))
    const row = label.closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: '重命名' }))
    const input = within(row).getByLabelText('重命名')
    fireEvent.change(input, { target: { value: '卧室的手机' } })

    // The dialog behind the edit owns the code and QR, so cancelling the edit
    // consumes the key instead of letting the modal close on it.
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    fireEvent(input, escape)
    await waitFor(() => { expect(within(row).queryByRole('textbox')).toBeNull() })

    expect(escape.defaultPrevented).toBe(true)
    expect(screen.getByText('客厅的手机')).toBeTruthy()
    expect(subject.rename).not.toHaveBeenCalled()
  })

  it('re-schedules a device from a preset and from an arbitrary day count', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(START))
    const subject = mount({ api: fakeApi({ devices: { ok: true, value: [WINDOWED] } }) })

    const label = await waitFor(() => screen.getByText('客厅的手机'))
    const row = label.closest('li')!
    // The lifetime selector opens a menu; a preset applies on selection.
    fireEvent.click(within(row).getByRole('button', { name: '30 天' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '7 天' }))
    await waitFor(() => { expect(subject.setLifetime).toHaveBeenCalledWith('device-1', 7) })

    // The pinned custom entry opens the arbitrary-days row.
    fireEvent.click(within(row).getByRole('button', { name: '30 天' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '自定义…' }))
    const days = within(row).getByLabelText('天数') as HTMLInputElement
    fireEvent.change(days, { target: { value: '45' } })
    fireEvent.click(within(row).getByRole('button', { name: '设为' }))
    await waitFor(() => { expect(subject.setLifetime).toHaveBeenCalledWith('device-1', 45) })

    fireEvent.change(days, { target: { value: '366' } })
    expect(within(row).getByRole<HTMLButtonElement>('button', { name: '设为' }).disabled).toBe(true)
    fireEvent.change(days, { target: { value: '0' } })
    expect(within(row).getByRole<HTMLButtonElement>('button', { name: '设为' }).disabled).toBe(true)
    expect(subject.setLifetime).toHaveBeenCalledTimes(2)

    // The selector toggles its menu shut, and Escape closes it too.
    fireEvent.click(within(row).getByRole('button', { name: '30 天' }))
    fireEvent.click(within(row).getByRole('button', { name: '30 天' }))
    expect(screen.queryByRole('menuitem')).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: '30 天' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('menuitem')).toBeNull() })

    // Picking a preset while the arbitrary-days row is open folds that row away.
    fireEvent.click(within(row).getByRole('button', { name: '30 天' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '7 天' }))
    expect(within(row).queryByLabelText('天数')).toBeNull()
  })

  it('states the revoke guidance and reports a refused re-schedule', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(START))
    const subject = mount({ api: fakeApi({
      devices: { ok: true, value: [WINDOWED] },
      setLifetime: { ok: false, reason: 'failed' },
    }) })

    expect(screen.getByText('不再使用、或在不受信任的网络上用过的设备请吊销；吊销后设备进入回收站，可以恢复或彻底删除。')).toBeTruthy()
    expect(screen.getByText('延长后，手机下一次请求时即续期；已经失效的凭证必须重新配对。')).toBeTruthy()

    const row = (await waitFor(() => screen.getByText('客厅的手机'))).closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: '30 天' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '1 天' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('操作失败，请重试。') })
    expect(subject.setLifetime).toHaveBeenCalledWith('device-1', 1)
    expect(screen.getByText('客厅的手机')).toBeTruthy()
  })

  it('keeps the listed devices when the re-read after a re-schedule fails', async () => {
    const subject = mount({ api: fakeApi({ devices: { ok: true, value: [WINDOWED] } }) })
    const row = (await waitFor(() => screen.getByText('客厅的手机'))).closest('li')!
    subject.devices.mockResolvedValue({ ok: false, reason: 'failed' })

    fireEvent.click(within(row).getByRole('button', { name: '30 天' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '7 天' }))

    await waitFor(() => { expect(subject.setLifetime).toHaveBeenCalledWith('device-1', 7) })
    expect(screen.getByText('客厅的手机')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
