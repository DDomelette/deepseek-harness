/** The bash executor's own settings section as the Loader and a committed write resolve it. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

/** Mount the executor under a Loader entry and read the mounted provider back. */
async function boot(config: object = {}) {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  const configuration = await liveConfig(ctx, LocalBashExecutor, { timeoutMs: 60_000, ...config })
  const bash = (): LocalBashExecutor => ctx.shell as LocalBashExecutor
  return { ctx, configuration, bash }
}

describe('bash settings section', () => {
  it('resolves the committed entry over the composition value', async () => {
    const bench = await boot()
    expect(bench.bash().config.timeoutMs.get()).toBe(60_000)

    await bench.configuration.update({ timeoutMs: 5_000 })

    expect(bench.bash().config.timeoutMs.get()).toBe(5_000)
    await bench.ctx.fiber.dispose()
  })

  it('refuses a stored value the executor could not run with', async () => {
    const bench = await boot()

    await expect(bench.configuration.update({ timeoutMs: 0 }))
      .rejects.toThrow(/positive finite/)

    expect(bench.bash().config.timeoutMs.get()).toBe(60_000)
    await bench.ctx.fiber.dispose()
  })

  it('refuses a grace period longer than a timer can carry', async () => {
    const bench = await boot()

    await expect(bench.configuration.update({ graceMs: Number.MAX_SAFE_INTEGER }))
      .rejects.toThrow(/graceMs must be no greater than/)

    await bench.ctx.fiber.dispose()
  })

  it('serves the stored section to every later read', async () => {
    const bench = await boot()
    await bench.configuration.update({ maxOutputBytes: 1_024, cwd: '/tmp' })

    const spec = bench.bash().resolve({ command: 'true' })

    expect(spec.stdoutMaxBytes).toBe(1_024)
    expect(spec.workdir).toBe('/tmp')
    await bench.ctx.fiber.dispose()
  })

  it('returns to the schema defaults when the stored section is cleared', async () => {
    const bench = await boot()
    await bench.configuration.update({ timeoutMs: 5_000 })
    expect(bench.bash().config.timeoutMs.get()).toBe(5_000)

    await bench.configuration.replace({})

    expect(bench.bash().config.timeoutMs.get()).toBe(120_000)
    await bench.ctx.fiber.dispose()
  })

  it('keeps the composition entry when the executor is mounted without a Loader', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalBashExecutor, { timeoutMs: 1_234 })

    expect((ctx.shell as LocalBashExecutor).config.timeoutMs.get()).toBe(1_234)
    await ctx.fiber.dispose()
  })

  it('releases the shell provider when the executor unloads', async () => {
    const bench = await boot()
    expect(bench.ctx.get('shell')).toBeDefined()

    await bench.configuration.fiber.dispose()

    expect(bench.ctx.get('shell')).toBeUndefined()
    await bench.ctx.fiber.dispose()
  })
})
