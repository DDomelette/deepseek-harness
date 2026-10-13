// The composer's Access seat data: the process permission catalog read over the
// mounted Remote. Covers the first read, the re-read a forwarded
// `permission-presets/catalog-changed` triggers, and the states the composer
// bar has to survive: the catalog not yet arrived, a failed read, a refusal,
// and a slow read that must not republish over a newer one.

import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { PermissionCatalog } from '@deepseek-ai/dsh-permission-presets/client'
import { PermissionCatalogSeat, type PermissionOptions } from '../src/client/permission-catalog.ts'

const CATALOG: PermissionCatalog = {
  options: [{ value: 'read-only', name: 'read-only' }, { value: 'danger-full-access', name: 'danger-full-access' }],
  defaultOptions: [{ value: 'read-only', name: 'read-only' }],
  defaultPreset: 'read-only',
}

type Answer = { ok: true; value: PermissionCatalog } | { ok: false }

/** One Remote stub recording its reads, answering from a script of factories. */
function wire(answers: readonly (() => Promise<Answer>)[]): {
  catalog: () => Promise<Answer>
  reads: () => number
} {
  let reads = 0
  return {
    catalog: () => {
      const answer = answers[Math.min(reads, answers.length - 1)]!
      reads += 1
      return answer()
    },
    reads: () => reads,
  }
}

/** A seat over a fresh snapshot plus that snapshot, as apply builds the pair. */
function seatOver(
  remote: { catalog: () => Promise<Answer> },
  subscribeChanged: (listener: () => void) => () => void = () => () => {},
): { seat: PermissionCatalogSeat; options: SnapshotStore<PermissionOptions> } {
  const options = createSnapshotStore<PermissionOptions>(undefined)
  return { seat: new PermissionCatalogSeat(options, remote, subscribeChanged), options }
}

describe('permission catalog seat', () => {
  it('publishes the catalog options once the first read settles', async () => {
    const { seat, options } = seatOver(wire([() => Promise.resolve({ ok: true, value: CATALOG })]))
    expect(options.getSnapshot()).toBeUndefined()
    await seat.refresh()
    expect(options.getSnapshot()).toBe(CATALOG.options)
  })

  it('re-reads when the Host reports the catalog changed', async () => {
    const changed: PermissionCatalog = { ...CATALOG, options: [{ value: 'workspace-write', name: 'workspace-write' }] }
    const remote = wire([
      () => Promise.resolve({ ok: true, value: CATALOG }),
      () => Promise.resolve({ ok: true, value: changed }),
    ])
    let notify: (() => void) | undefined
    const { seat, options } = seatOver(remote, (listener) => {
      notify = listener
      return () => { notify = undefined }
    })
    const dispose = seat.start()
    await vi.waitFor(() => { expect(options.getSnapshot()).toBe(CATALOG.options) })
    expect(remote.reads()).toBe(1)
    notify?.()
    await vi.waitFor(() => { expect(options.getSnapshot()).toBe(changed.options) })
    expect(remote.reads()).toBe(2)
    dispose()
    expect(notify).toBeUndefined()
  })

  it('keeps the seat absent while the first read is still in flight', () => {
    const { seat, options } = seatOver(wire([() => new Promise(() => {})]))
    void seat.refresh()
    expect(options.getSnapshot()).toBeUndefined()
  })

  it('keeps the published options when a read fails or is refused', async () => {
    const { seat, options } = seatOver(wire([
      () => Promise.resolve({ ok: true, value: CATALOG }),
      () => Promise.reject(new Error('carrier down')),
      () => Promise.resolve({ ok: false }),
    ]))
    await seat.refresh()
    await seat.refresh()
    expect(options.getSnapshot()).toBe(CATALOG.options)
    await seat.refresh()
    expect(options.getSnapshot()).toBe(CATALOG.options)
  })

  it('lets a newer read win over a slower older one', async () => {
    const older: PermissionCatalog = { ...CATALOG, options: [{ value: 'read-only', name: 'read-only' }] }
    const settled: (() => void)[] = []
    const remote = wire([
      () => new Promise((resolve) => { settled.push(() => { resolve({ ok: true, value: older }) }) }),
      () => Promise.resolve({ ok: true, value: CATALOG }),
    ])
    const { seat, options } = seatOver(remote)
    const slow = seat.refresh()
    await seat.refresh()
    expect(options.getSnapshot()).toBe(CATALOG.options)
    settled.forEach((finish) => { finish() })
    await slow
    expect(options.getSnapshot()).toBe(CATALOG.options)
  })
})
