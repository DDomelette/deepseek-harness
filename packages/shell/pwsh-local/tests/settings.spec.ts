/** The pwsh executor's own settings section as the Loader and a committed write resolve it. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { PwshLocalExecutor } from '@deepseek-ai/dsh-pwsh-local'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

/** Mount the executor under a Loader entry and read the mounted provider back. */
async function boot(config: object = {}) {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  const configuration = await liveConfig(ctx, PwshLocalExecutor, { timeoutMs: 60_000, ...config })
  const pwsh = (): PwshLocalExecutor => ctx.shell as PwshLocalExecutor
  return { ctx, configuration, pwsh }
}

describe('pwsh executor over its settings section', () => {
  it('resolves the committed entry over the composition value', async () => {
    const bench = await boot()
    expect(bench.pwsh().config.timeoutMs.get()).toBe(60_000)

    await bench.configuration.update({ timeoutMs: 5_000 })

    expect(bench.pwsh().config.timeoutMs.get()).toBe(5_000)
    await bench.ctx.fiber.dispose()
  })

  it('refuses a stored value the executor could not run with', async () => {
    const bench = await boot()

    await expect(bench.configuration.update({ timeoutMs: 0 }))
      .rejects.toThrow(/pwsh-local: timeoutMs must be a positive finite number/)

    expect(bench.pwsh().config.timeoutMs.get()).toBe(60_000)
    await bench.ctx.fiber.dispose()
  })

  it('re-resolves the executable when the stored path changes', async () => {
    const bench = await boot({ pwshPath: '/opt/first/pwsh' })
    expect(bench.pwsh().pwshPath).toBe('/opt/first/pwsh')

    await bench.configuration.update({ pwshPath: '/opt/second/pwsh' })

    expect(bench.pwsh().pwshPath).toBe('/opt/second/pwsh')
    await bench.ctx.fiber.dispose()
  })

  it('keeps the resolved executable when an unrelated field changes', async () => {
    const bench = await boot({ pwshPath: '/opt/first/pwsh' })
    const before = bench.pwsh().pwshPath

    await bench.configuration.update({ timeoutMs: 5_000 })

    expect(bench.pwsh().pwshPath).toBe(before)
    await bench.ctx.fiber.dispose()
  })

  it('returns to the schema defaults when the stored section is cleared', async () => {
    const bench = await boot({ pwshPath: '/opt/first/pwsh' })
    await bench.configuration.update({ timeoutMs: 5_000, pwshPath: '/opt/second/pwsh' })
    expect(bench.pwsh().config.timeoutMs.get()).toBe(5_000)
    expect(bench.pwsh().pwshPath).toBe('/opt/second/pwsh')

    await bench.configuration.replace({})

    expect(bench.pwsh().config.timeoutMs.get()).toBe(120_000)
    expect(bench.pwsh().config.pwshPath.get()).toBeUndefined()
    await bench.ctx.fiber.dispose()
  })

  it('releases the shell provider when the executor unloads', async () => {
    const bench = await boot()
    expect(bench.ctx.get('shell')).toBeDefined()

    await bench.configuration.fiber.dispose()

    expect(bench.ctx.get('shell')).toBeUndefined()
    await bench.ctx.fiber.dispose()
  })
})
