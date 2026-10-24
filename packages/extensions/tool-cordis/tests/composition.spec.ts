import { Context } from '@deepseek-ai/cordis'
import CordisHostRunner, { CordisInspectRegistryService } from '@deepseek-ai/dsh-cordis-host-runner'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, onTestFinished } from 'vitest'
import * as ToolCordis from '../src/index.ts'

async function harness(dynamicRunner: boolean) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (dynamicRunner) {
    await ctx.plugin(CordisHostRunner)
  } else {
    await ctx.plugin((inner: Context) => { new CordisInspectRegistryService(inner, 1000) })
  }
  return ctx
}

describe('Cordis tool composition', () => {
  it.each([{}, { dynamicPlugins: false }])('serves read-only tools without a dynamic runner (%j)', async (config) => {
    const ctx = await harness(false)
    const fiber = ctx.plugin(ToolCordis, config)
    await fiber
    expect(ctx.get('dynamicCordisRunner')).toBeUndefined()
    expect(ctx.tools.schemas().map(tool => tool.name).sort()).toEqual(['cordis_inspect_list', 'cordis_inspect_query'])
    await fiber.dispose()
    expect(ctx.tools.schemas()).toEqual([])
  })

  it('registers and disposes the complete opt-in toolset with its runner', async () => {
    const ctx = await harness(true)
    const fiber = ctx.plugin(ToolCordis, { dynamicPlugins: true })
    await fiber
    expect(ctx.tools.schemas().map(tool => tool.name).sort()).toEqual([
      'cordis_define', 'cordis_inspect_list', 'cordis_inspect_query', 'cordis_inspect_self',
      'cordis_run', 'cordis_stop', 'cordis_undefine',
    ])
    await fiber.dispose()
    expect(ctx.tools.schemas()).toEqual([])
  })
})
