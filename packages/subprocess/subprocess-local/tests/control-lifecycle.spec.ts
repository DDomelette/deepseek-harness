import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { LocalSubprocessRuntime } from '../src/index.ts'

let ctx: Context | undefined
let handle: SubprocessHandle | undefined

afterEach(async () => {
  handle?.control?.destroy()
  handle?.terminate()
  await handle?.waitForExit()
  await ctx?.fiber.dispose()
  ctx = undefined
  handle = undefined
})

describe('managed subprocess control pipe', () => {
  it('joins an exited range and disposes its paused control endpoint without draining it', async () => {
    ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    handle = ctx.subprocess.spawn({
      argv: [process.execPath, '--input-type=module', '-e',
        'import { Socket } from "node:net"; const c = new Socket({fd:7,readable:true,writable:true}); c.write(Buffer.alloc(4096),()=>c.destroy())'],
      cwd: process.cwd(),
      stdio: { stdin: 'ignore', stdout: { maxBytes: 32 }, stderr: { maxBytes: 32 }, control: 'pipe' },
      graceMs: 1000,
    })
    const channel = handle.control
    if (channel === undefined) throw new Error('requested control pipe is absent')
    channel.pause()
    expect(await handle.done).toEqual({ exitCode: 0, signal: null })
    expect(channel.destroyed).toBe(false)
    expect(await handle.waitForExit(AbortSignal.timeout(10_000))).toBe(true)
    await ctx.fiber.dispose()
    expect(channel.destroyed).toBe(true)
    expect(channel.closed).toBe(true)
  }, 15_000)

  it('closes the caller endpoint when service disposal terminates an active program', async () => {
    ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    handle = ctx.subprocess.spawn({
      argv: [process.execPath, '--input-type=module', '-e',
        'import { Socket } from "node:net"; const c = new Socket({fd:7,readable:true,writable:true}); c.write("ready"); setInterval(()=>{},60000)'],
      cwd: process.cwd(),
      stdio: { stdin: 'ignore', stdout: { maxBytes: 32 }, stderr: { maxBytes: 32 }, control: 'pipe' },
      graceMs: 1000,
    })
    const channel = handle.control
    if (channel === undefined) throw new Error('requested control pipe is absent')
    await once(channel, 'data')
    await ctx.fiber.dispose()
    expect(channel.destroyed).toBe(true)
    expect(await handle.waitForExit()).toBe(true)
  })
})
