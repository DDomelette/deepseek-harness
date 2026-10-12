import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import SettingsController from '../src/index.ts'
import { configurationFixture } from '../../../settings/settings/tests/configuration-fixture.ts'

/** Namespace of the composition's first probe entry: one Loader entry id, whose Config carries the live fields. */
const NS = 'first'
/** The settings document the profile composition owns, reported by `hasDocument`. */
const DOCUMENT = '/deployment/cordis.patch.yml'

/**
 * Boot the real configuration composition (`config-editor`, `settings`, two
 * probe entries exporting Config schemas) and mount the controller on it.
 * @returns the booted context with its profile and the controller under test.
 */
async function boot() {
  const fixture = await configurationFixture()
  await fixture.ctx.plugin(SettingsController)
  return { ...fixture, controller: fixture.ctx.settingsController }
}

/** Report a settings fact the composition itself cannot produce, such as a seam owning no document. */
function fakeDocumentPath(ctx: Context, value: string | undefined): void {
  Object.defineProperty(ctx.settings, 'documentPath', { configurable: true, get: () => value })
}

/** One descriptor for the probe entry, carrying only the fields a page always reads. */
function bareDescriptor() {
  return { ns: NS as never, schema: {}, value: {}, autoGenerate: true, applies: 'live' as const, revision: 0 }
}

/**
 * Build a controller whose native document opener is the supplied stand-in:
 * `openTextFile` is a protected test seam, so a subclass replaces it.
 * @param ctx - host context to mount the probe controller on.
 * @param open - opener the controller calls instead of the platform's.
 * @returns the controller with that opener.
 */
function controllerOpeningWith(ctx: Context, open: (path: string, signal: AbortSignal) => Promise<void>): SettingsController {
  return new (class extends SettingsController {
    protected override openTextFile = open
  })(ctx)
}

describe('the settings Remote namespace a configuration page calls', () => {
  it('publishes the settings namespace from its own service key', async () => {
    const { controller } = await boot()
    expect(controller.typertRemote.serviceKey).toBe('settingsController')
    expect(controller.typertRemote.namespace).toBe('settings')
    expect(remoteMethods(controller)).toEqual([
      { method: 'describe', invocation: { kind: 'direct' } },
      { method: 'update', invocation: { kind: 'direct' } },
      { method: 'replace', invocation: { kind: 'direct' } },
      { method: 'mutate', invocation: { kind: 'direct' } },
      { method: 'openSettingsDocument', invocation: { kind: 'direct' } },
    ])
  })

  it('reports the actionable configuration error while no settings provider is mounted', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SettingsController)
    const calls: Array<() => unknown> = [
      () => ctx.settingsController.describe(),
      () => ctx.settingsController.update('ui-test', {}, undefined),
      () => ctx.settingsController.replace('ui-test', {}, undefined),
      () => ctx.settingsController.mutate('ui-test', [], undefined),
      () => ctx.settingsController.openSettingsDocument(new AbortController().signal),
    ]
    for (const call of calls) {
      const failure = await Promise.resolve().then(call).catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({
        code: 'gateway/internal',
        message: 'settings service is absent: this deployment does not mount a settings provider (e.g. @deepseek-ai/dsh-settings) in its composition',
        details: {},
      })
    }
  })

  it('mounts the credentials namespace beside its own', async () => {
    const { ctx } = await configurationFixture()
    const fiber = ctx.plugin(SettingsController)
    await fiber.await()
    expect(ctx.get('credentialsController')).toBeDefined()
    await fiber.dispose()
    expect(ctx.get('settingsController')).toBeUndefined()
    expect(ctx.get('credentialsController')).toBeUndefined()
  })

  it('describes every namespace redacted, with the deployment facts around them', async () => {
    const { controller } = await boot()
    await controller.update(NS, { token: 'sk-stored' }, undefined)
    const value = controller.describe()
    expect(value).toMatchObject({ writable: true, hasDocument: true })
    const view = value.namespaces.find(row => row.ns === NS)
    expect(view?.ns).toBe(NS)
    expect(value.namespaces.some(row => row.ns === 'second')).toBe(true)
    // The secret never rides; its slot reports only that one is stored.
    expect(JSON.stringify(value)).not.toContain('sk-stored')
    expect(view?.secrets).toEqual([{ path: ['token'], set: true }])
    // Redaction removes the field rather than replacing it, so the layer that
    // stored a secret comes back empty instead of carrying a placeholder.
    expect(view?.user).toEqual({})
  })

  it('reports a read-only provider and omits the layers it has none of', async () => {
    const { ctx, controller } = await boot()
    vi.spyOn(ctx.settings, 'writable', 'get').mockReturnValue(false)
    fakeDocumentPath(ctx, undefined)
    expect(controller.describe()).toMatchObject({ writable: false, hasDocument: false })
    // A descriptor naming neither optional layer stays without both: the
    // projection copies declared fields, it never invents an empty one.
    vi.spyOn(ctx.settings, 'describe').mockReturnValue([bareDescriptor()])
    const view = controller.describe().namespaces[0]
    expect(view && 'base' in view).toBe(false)
    expect(view && 'user' in view).toBe(false)
  })

  it('declares an empty slot list when the provider names no secrets', async () => {
    const { ctx, controller } = await boot()
    vi.spyOn(ctx.settings, 'describe').mockReturnValue([bareDescriptor()])
    const view = controller.describe().namespaces[0]
    expect(view?.secrets).toEqual([])
  })

  it('carries the composition base layer when the registrant declared one', async () => {
    const { controller } = await boot()
    const view = controller.describe().namespaces.find(row => row.ns === NS)
    // The probe entry's bundle patch declares `token: private`, so the base
    // layer resolves the schema defaults over that composition config.
    expect(view?.base).toEqual({ count: 2, list: [] })
  })

  it('applies path-addressed edits and answers with the namespace it just wrote', async () => {
    const { controller } = await boot()
    const view = await controller.mutate(NS, [{ op: 'set', path: ['count'], value: 5 }], undefined)
    expect(view).toMatchObject({ ns: NS, user: { count: 5 } })
    expect(view.revision).toBeGreaterThan(0)
  })

  it('supports merge updates and wholesale replacement on the Remote namespace', async () => {
    const { controller } = await boot()
    const updated = await controller.update(NS, { count: 7, token: 'sk-stored' }, undefined)
    expect(updated.user).toEqual({ count: 7 })
    expect(updated.secrets).toEqual([{ path: ['token'], set: true }])

    const replaced = await controller.replace(NS, {}, updated.revision)
    // A reset returns the entry to its composition base, whose own secret keeps
    // the slot set while the user layer empties.
    expect(replaced.value).toEqual({ count: 2, list: [] })
    expect(replaced.user).toEqual({})
    expect(replaced.secrets).toEqual([{ path: ['token'], set: true }])
  })

  it('refuses a stale write as settings/conflict carrying both revisions', async () => {
    const { controller } = await boot()
    const held = controller.describe().namespaces.find(row => row.ns === NS)!.revision
    await controller.mutate(NS, [{ op: 'set', path: ['count'], value: 7 }], held)
    const failure = await controller
      .mutate(NS, [{ op: 'set', path: ['count'], value: 9 }], held)
      .catch((error: unknown) => error)
    const { code, details } = remoteErrorOf(failure) ?? {}
    expect(code).toBe('settings/conflict')
    expect(details).toMatchObject({ ns: NS, expected: held })
  })

  it('answers a malformed namespace exactly as an unregistered one', async () => {
    const { controller } = await boot()
    for (const ns of ['Not A Namespace', 'unregistered']) {
      const failure = await controller.mutate(ns, [{ op: 'unset', path: ['count'] }], undefined)
        .catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({
        code: 'settings/rejected',
        details: { ns },
      })
    }
  })

  it('reports an empty namespace as bad-request', async () => {
    const { controller } = await boot()
    for (const call of [
      () => controller.update('', {}, undefined),
      () => controller.replace('', {}, undefined),
      () => controller.mutate('', [], undefined),
    ]) {
      const failure = await call().catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/bad-request' })
    }
  })

  it('reports a refused write as settings/rejected carrying the seam message', async () => {
    const { controller } = await boot()
    // `ordinary` is declared by the composition and is not volatile, so the
    // settings seam refuses the edit before anything reaches the profile patch.
    const failure = await controller.update(NS, { ordinary: 'changed' }, undefined)
      .catch((error: unknown) => error)
    const { code, message } = remoteErrorOf(failure) ?? {}
    expect(code).toBe('settings/rejected')
    expect(message).toContain('not volatile')
  })

  it('stringifies a refusal that is not an Error', async () => {
    const { ctx, controller } = await boot()
    vi.spyOn(ctx.settings, 'mutate').mockRejectedValue('the document is locked')
    const failure = await controller.mutate(NS, [{ op: 'unset', path: ['count'] }], undefined)
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)?.message).toBe('the document is locked')
  })

  it('reports a namespace disposed between the write and its read-back', async () => {
    const { ctx, controller } = await boot()
    const entry = ctx.configEditor.entries().find(row => row.options.id === NS)!
    vi.spyOn(ctx.settings, 'update').mockImplementation(async () => { entry.parent.remove(entry.options.id) })
    const failure = await controller.update(NS, { count: 7 }, undefined)
      .catch((error: unknown) => error)
    const { code, message } = remoteErrorOf(failure) ?? {}
    expect(code).toBe('gateway/internal')
    expect(message).toContain('was disposed after the update')
  })

  it('prepares and opens the provider-owned settings document', async () => {
    const { ctx } = await configurationFixture()
    const prepare = vi.spyOn(ctx.settings, 'prepareDocument').mockResolvedValue(DOCUMENT)
    const openTextFile = vi.fn((_path: string, _signal: AbortSignal) => Promise.resolve())
    const controller = controllerOpeningWith(ctx, openTextFile)
    const signal = new AbortController().signal

    await expect(controller.openSettingsDocument(signal)).resolves.toEqual({ opened: true })
    expect(prepare).toHaveBeenCalledOnce()
    expect(openTextFile).toHaveBeenCalledWith(DOCUMENT, signal)
  })

  it('preserves settings-document absence, failure, and cancellation', async () => {
    const absent = await configurationFixture()
    vi.spyOn(absent.ctx.settings, 'prepareDocument').mockResolvedValue(undefined as unknown as string)
    const absentController = new SettingsController(absent.ctx)
    const missingDocument = absentController.openSettingsDocument(new AbortController().signal)
    await expect(missingDocument).rejects.toMatchObject({ code: 'gateway/internal' })
    await expect(missingDocument).rejects.toThrow('no local document')

    const failed = await configurationFixture()
    const prepare = vi.spyOn(failed.ctx.settings, 'prepareDocument')
    prepare.mockRejectedValue(new Error('read failed'))
    const failedController = new SettingsController(failed.ctx)
    const failedRead = failedController.openSettingsDocument(new AbortController().signal)
    await expect(failedRead).rejects.toMatchObject({ code: 'gateway/internal' })
    await expect(failedRead).rejects.toThrow('read failed')

    const cancelled = new AbortController()
    cancelled.abort(new Error('cancelled'))
    prepare.mockClear()
    await expect(failedController.openSettingsDocument(cancelled.signal))
      .rejects.toMatchObject({ code: 'gateway/cancelled' })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('does not open a settings document cancelled during preparation', async () => {
    const { ctx } = await configurationFixture()
    const prepared = Promise.withResolvers<string>()
    vi.spyOn(ctx.settings, 'prepareDocument').mockReturnValue(prepared.promise)
    const openTextFile = vi.fn((_path: string, _signal: AbortSignal) => Promise.resolve())
    const controller = controllerOpeningWith(ctx, openTextFile)
    const abort = new AbortController()

    const opening = controller.openSettingsDocument(abort.signal)
    abort.abort(new Error('cancelled'))
    prepared.resolve(DOCUMENT)

    await expect(opening).rejects.toMatchObject({ code: 'gateway/cancelled' })
    expect(openTextFile).not.toHaveBeenCalled()
  })

  it('maps native settings-document opener failures', async () => {
    const { ctx } = await configurationFixture()
    vi.spyOn(ctx.settings, 'prepareDocument').mockResolvedValue(DOCUMENT)
    const controller = controllerOpeningWith(ctx, () => Promise.reject(new Error('no default editor')))

    await expect(controller.openSettingsDocument(new AbortController().signal))
      .rejects.toMatchObject({ code: 'gateway/internal', message: 'path open failed: no default editor' })
  })

  it('classifies cancellation while preparing or opening the settings document', async () => {
    const preparing = await configurationFixture()
    const prepareAbort = new AbortController()
    vi.spyOn(preparing.ctx.settings, 'prepareDocument').mockImplementation(async () => {
      prepareAbort.abort(new Error('cancelled'))
      throw new Error('preparation stopped')
    })
    const preparingController = new SettingsController(preparing.ctx)
    await expect(preparingController.openSettingsDocument(prepareAbort.signal))
      .rejects.toMatchObject({ code: 'gateway/cancelled' })

    const opening = await configurationFixture()
    vi.spyOn(opening.ctx.settings, 'prepareDocument').mockResolvedValue(DOCUMENT)
    const openAbort = new AbortController()
    const openingController = controllerOpeningWith(opening.ctx, async () => {
      openAbort.abort(new Error('cancelled'))
      throw new Error('opening stopped')
    })
    await expect(openingController.openSettingsDocument(openAbort.signal))
      .rejects.toMatchObject({ code: 'gateway/cancelled' })
  })
})
