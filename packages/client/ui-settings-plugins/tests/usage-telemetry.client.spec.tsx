// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate, stubSettingsScope, workspaceSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import { UsageTelemetryCard, type UsageTelemetryCardProps } from '../src/client/UsageTelemetryCard.tsx'
import { UsageTelemetryCardController, type UsageTelemetrySettings } from '../src/client/usage-telemetry-card-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function bench() {
  const host = stubSettingsScope<UsageTelemetrySettings>()
  const controller = new UsageTelemetryCardController(host.scope)
  onTestFinished(() => { controller.dispose() })
  const face = controller.inject()
  return { host, controller, face, snapshot: () => controller.store.getSnapshot() }
}

describe('usage telemetry settings', () => {
  it('follows committed settings and stops publishing after disposal', () => {
    const { host, controller, snapshot } = bench()
    expect(snapshot()).toMatchObject({ available: false, writable: false, enabled: true, draft: true })
    expect(host.listenerCount()).toBe(1)
    host.publish({ status: 'ready', writable: true, value: { enabled: false } })
    expect(snapshot()).toMatchObject({ available: true, writable: true, enabled: false, draft: false })
    controller.dispose()
    expect(host.listenerCount()).toBe(0)
    const settled = snapshot()
    host.publish({ value: { enabled: true } })
    expect(snapshot()).toBe(settled)
  })

  it('stages resets from composition defaults and discards without writing', () => {
    const { host, face, snapshot } = bench()
    host.publish({ status: 'ready', writable: true, value: { enabled: false }, base: { enabled: false } })
    face.save()
    expect(host.mutate).not.toHaveBeenCalled()
    face.edit('enabled', 'true')
    expect(snapshot()).toMatchObject({ enabled: false, draft: true, dirty: true })
    face.resetField('enabled')
    expect(snapshot().draft).toBe(false)
    host.publish({ base: undefined })
    face.resetField('enabled')
    expect(snapshot().draft).toBe(true)
    face.discard()
    expect(snapshot()).toMatchObject({ draft: false, dirty: false, failed: false })
    expect(host.mutate).not.toHaveBeenCalled()
    expect(() => { face.edit('missing', 'true') }).toThrow('has no field missing')
    expect(() => { face.resetField('missing') }).toThrow('has no field missing')
  })

  it('writes one staged switch and waits for acceptance before clearing it', async () => {
    const { host, face, snapshot } = bench()
    host.publish({ status: 'ready', writable: true, value: { enabled: true } })
    const acceptance = Promise.withResolvers<boolean>()
    host.mutate.mockReturnValue(acceptance.promise)
    face.edit('enabled', 'false')
    face.save()
    try {
      face.save()
      expect(host.mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'set', path: ['enabled'], value: false }])
      expect(snapshot()).toMatchObject({ saving: true, dirty: true, draft: false, enabled: true })
      host.publish({ value: { enabled: false } })
    } finally {
      acceptance.resolve(true)
      await vi.waitFor(() => { expect(snapshot().saving).toBe(false) })
    }
    expect(snapshot()).toMatchObject({ enabled: false, draft: false, dirty: false, failed: false })
  })

  it.each(['refused', 'rejected'] as const)('retains a %s save for retry and clears failure on edit or discard', async (failure) => {
    const { host, face, snapshot } = bench()
    host.publish({ status: 'ready', writable: true, value: { enabled: true } })
    if (failure === 'refused') host.mutate.mockResolvedValue(false)
    else host.mutate.mockRejectedValue(new Error('disconnected'))
    face.edit('enabled', 'false')
    face.save()
    await vi.waitFor(() => { expect(snapshot().failed).toBe(true) })
    expect(snapshot()).toMatchObject({ saving: false, dirty: true, draft: false, enabled: true })
    face.edit('enabled', 'true')
    expect(snapshot().failed).toBe(false)
    face.discard()
    expect(snapshot()).toMatchObject({ dirty: false, failed: false, draft: true })
  })

  it('renders the recorder switch and sends staged changes through the controller', async () => {
    const { host, controller, face, snapshot } = bench()
    host.publish({ status: 'ready', writable: true, value: { enabled: true } })
    const props: UsageTelemetryCardProps = {
      ...face,
      t: makeTranslate(en),
      useUsageTelemetryCard: bindSnapshotSelector(controller.store),
      usePanelInfo: selector => selector({ activePanelId: null }),
      useSessions: selector => selector({
        ids: [], byId: {}, current: undefined, phase: 'ready',
        subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
      }),
      useSessionPendingInteraction: selector => selector(new Map()),
      useWorkspaces: selector => selector(workspaceSnapshot()),
      useResource: () => ({ status: 'none', value: undefined, failure: undefined }),
    }
    render(<UsageTelemetryCard {...props} />)
    fireEvent.click(screen.getByRole('button', { name: `${en.expand}: ${en.usageTelemetryTitle}` }))
    const checkbox = screen.getByRole('checkbox', { name: en.usageTelemetryEnabled })
    expect(checkbox).toHaveProperty('checked', true)
    fireEvent.click(checkbox)
    expect(snapshot()).toMatchObject({ dirty: true, draft: false })
    expect(host.mutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.discard }))
    expect(checkbox).toHaveProperty('checked', true)
    fireEvent.click(checkbox)
    const acceptance = Promise.withResolvers<boolean>()
    host.mutate.mockReturnValue(acceptance.promise)
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    try {
      expect(screen.getByRole('button', { name: en.saving })).toHaveProperty('disabled', true)
      act(() => { host.publish({ value: { enabled: false } }) })
    } finally {
      await act(async () => { acceptance.resolve(true) })
    }
    expect(host.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['enabled'], value: false }])
    expect(snapshot().dirty).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: `${en.expand}: ${en.usageTelemetryTitle}` }))
    act(() => { host.publish({ writable: false }) })
    expect(screen.getByRole('checkbox', { name: en.usageTelemetryEnabled })).toHaveProperty('disabled', true)
  })
})
