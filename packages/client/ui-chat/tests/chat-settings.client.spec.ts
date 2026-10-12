import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as HostPlugin from '../src/index.ts'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import { DEFAULT_TRANSCRIPT_VIEW_MODE, Config, apply } from '../src/index.ts'

describe('ui-chat Host settings', () => {
  it('registers, validates, and disposes the transcript-view preference', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    const { fiber } = configuration

    expect(plainConfig(configuration.fiber.config)).toEqual({ transcriptView: DEFAULT_TRANSCRIPT_VIEW_MODE })
    await configuration.update({ transcriptView: 'normal' })
    expect(plainConfig(configuration.fiber.config)).toEqual({ transcriptView: 'normal' })
    await expect(configuration.update({ transcriptView: 'dense' })).rejects.toThrow()

    await fiber.dispose()
  })

  it('loads without a settings provider', async () => {
    const ctx = new Context()
    await expect(ctx.plugin({ Config, apply }).await()).resolves.toBeDefined()
  })
})

it('keeps its own instance off the generated Settings pages', () => omitsGeneratedPage(ctx => ctx.plugin(HostPlugin)))
