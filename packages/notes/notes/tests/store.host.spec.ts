/**
 * The notes domain owner refuses to hand out a table before its fiber has
 * opened the domain. `[Service.init]` opens it, so this path is reachable when
 * a consumer constructs the service directly instead of mounting it.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { NotesStore } from '../src/store.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

describe('notes store', () => {
  it('refuses every handle before the domain is open', async () => {
    ctx = new Context()
    const store = new NotesStore(ctx)
    expect(() => store.materials).toThrow(/not open yet/)
    expect(() => store.sessions).toThrow(/not open yet/)
    expect(() => store.activeNoteId()).toThrow(/not open yet/)
    await expect(store.setActiveNoteId(null)).rejects.toThrow(/not open yet/)
  })
})
