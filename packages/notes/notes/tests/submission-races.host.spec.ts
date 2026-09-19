/** Concurrent edits and submission share the durable material's write order. */
import { afterEach, expect, it } from 'vitest'
import { Analysis } from '../src/analysis.ts'
import { NotesRemote } from '../src/remote.ts'
import { bench, material, noteSession } from './bench.ts'
import type { Bench } from './bench.ts'

let mounted: Bench | undefined

afterEach(async () => {
  await mounted?.dispose()
  mounted = undefined
})

async function subject() {
  const current = await bench()
  mounted = current
  await current.ctx.plugin(Analysis).await()
  await current.ctx.plugin(NotesRemote).await()
  const noteId = await current.sessions.record(noteSession())
  current.agents.open(noteSession().sessionId)
  const id = await current.materials.create(material({ noteId, text: 'original body' }))
  return { ...current, id }
}

it('refuses an edit queued after the first analysis claims its material', async () => {
  const p = await subject()
  const [analysis, edit] = await Promise.all([
    p.ctx.notesAnalysis.analyse(p.id),
    p.ctx.notes.materialUpdate({ id: p.id, text: 'edited body' }),
  ])
  expect(analysis).toBeNull()
  expect(edit).toEqual({ ok: false, error: { code: 'material-submitted', id: p.id } })
  expect(p.agents.followup.mock.calls[0]?.[0]).toMatchObject({
    content: [{ type: 'text', text: 'original body' }],
  })
  expect(p.materials.get(p.id)?.text).toBe('original body')
})

it('submits the saved body when the edit is queued before analysis', async () => {
  const p = await subject()
  const [edit, analysis] = await Promise.all([
    p.ctx.notes.materialUpdate({ id: p.id, text: 'edited body' }),
    p.ctx.notesAnalysis.analyse(p.id),
  ])
  expect(edit).toEqual({ ok: true, value: { applied: true } })
  expect(analysis).toBeNull()
  expect(p.agents.followup.mock.calls[0]?.[0]).toMatchObject({
    content: [{ type: 'text', text: 'edited body' }],
  })
  expect(p.materials.get(p.id)?.text).toBe('edited body')
})
