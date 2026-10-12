import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import * as HostPlugin from '../src/index.ts'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import { DEFAULT_PREFERENCE, Config, apply } from '@deepseek-ai/dsh-client-ui-theme'

/** Collect the injection table the way an index render or boot payload does. */
function collect(ctx: Context): IndexInjection[] {
  const table: IndexInjection[] = []
  ctx.emit('webserver/index-inject', table)
  return table
}

/** Narrow the theme row and return its script body. */
function scriptText(row: IndexInjection | undefined): string {
  if (row?.kind !== 'script') throw new Error('expected a script row')
  return row.text
}

describe('ui-theme host', () => {
  it('registers, validates, and disposes the durable theme preference', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    const { fiber } = configuration
    expect(plainConfig(configuration.fiber.config)).toEqual({ preference: DEFAULT_PREFERENCE, fontSize: 14 })
    await configuration.update({ preference: 'dark', fontSize: 16 })
    expect(plainConfig(configuration.fiber.config)).toEqual({ preference: 'dark', fontSize: 16 })
    await expect(configuration.update({ preference: 'sepia' })).rejects.toThrow()
    await expect(configuration.update({ fontSize: 11 })).rejects.toThrow()
    await expect(configuration.update({ fontSize: 18 })).rejects.toThrow()
    await fiber.dispose()
  })

  it('answers each collection with the current durable preference until disposal', async () => {
    const ctx = new Context()
    ctx.on('webserver/index-inject', (table) => {
      table.push({ kind: 'script', placement: 'head', text: 'window.afterTheme=true' })
    })
    const configuration = await liveConfig(ctx, { Config, apply })
    const { fiber } = configuration
    const rows = collect(ctx)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ kind: 'script', placement: 'body' })
    expect(rows[1]).toMatchObject({ kind: 'script', placement: 'head', text: 'window.afterTheme=true' })
    expect(scriptText(rows[0])).toContain('const preference = "system"')
    expect(scriptText(rows[0])).toContain('"14px"')
    await configuration.update({ preference: 'dark', fontSize: 17 })
    expect(scriptText(collect(ctx)[0])).toContain('const preference = "dark"')
    expect(scriptText(collect(ctx)[0])).toContain('"17px"')
    await fiber.dispose()
    expect(collect(ctx)).toEqual([{ kind: 'script', placement: 'head', text: 'window.afterTheme=true' }])
  })

  it('uses the system preference without a settings provider', async () => {
    const ctx = new Context()
    await ctx.plugin({ Config, apply }).await()
    expect(scriptText(collect(ctx)[0])).toContain('const preference = "system"')
  })
})

it('keeps its own instance off the generated Settings pages', () => omitsGeneratedPage(ctx => ctx.plugin(HostPlugin)))
