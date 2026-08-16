import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  USAGE_TELEMETRY_NS, UsageTelemetryCardController,
} from '../src/client/usage-telemetry-card-controller.ts'

describe('UsageTelemetryCardController', () => {
  function subject(initial: { value?: { enabled?: boolean }; user?: { enabled?: boolean }; writable?: boolean } = {}) {
    const host = stubSettingsScope<{ enabled?: boolean }>()
    host.publish({
      status: 'ready',
      writable: initial.writable ?? true,
      value: initial.value ?? { enabled: true },
      base: { enabled: true },
      user: initial.user ?? {},
      revision: 1,
    })
    host.set.mockImplementation((_field: string, value: unknown) => {
      host.publish({ ...host.scope.getSnapshot(), value: { enabled: value as boolean }, user: { enabled: value as boolean } })
    })
    const controller = new UsageTelemetryCardController(host.scope)
    return { host, face: controller.inject(), store: controller.store }
  }

  it('shows the effective value and stays clean until edited', () => {
    const { store } = subject()
    expect(store.getSnapshot()).toMatchObject({ available: true, writable: true, enabled: true, draft: true, dirty: false })
  })

  it('stages the opposite value and writes only the enabled leaf on save', async () => {
    const { host, face, store } = subject()
    face.edit('enabled', 'false')
    expect(store.getSnapshot()).toMatchObject({ draft: false, dirty: true })

    face.save()
    await vi.waitFor(() => { expect(store.getSnapshot().dirty).toBe(false) })

    expect(host.set).toHaveBeenCalledWith('enabled', false)
    expect(store.getSnapshot()).toMatchObject({ enabled: false, draft: false, dirty: false, failed: false })
  })

  it('keeps a rejected save dirty and failed', async () => {
    const host = stubSettingsScope<{ enabled?: boolean }>()
    host.publish({ status: 'ready', writable: true, value: { enabled: true }, base: { enabled: true }, user: {}, revision: 1 })
    host.set.mockImplementation(() => {
      host.publish({ ...host.scope.getSnapshot(), value: { enabled: true }, user: {} })
    })
    const controller = new UsageTelemetryCardController(host.scope)
    const face = controller.inject()
    face.edit('enabled', 'false')
    face.save()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().failed).toBe(true) })
    expect(controller.store.getSnapshot()).toMatchObject({ draft: false, dirty: true, failed: true, enabled: true })
  })

  it('discard drops the staged edit', () => {
    const { face, store } = subject()
    face.edit('enabled', 'false')
    face.discard()
    expect(store.getSnapshot()).toMatchObject({ draft: true, dirty: false })
  })

  it('spells the namespace literal used by the card binding', () => {
    expect(USAGE_TELEMETRY_NS).toBe('usage-telemetry')
  })
})
