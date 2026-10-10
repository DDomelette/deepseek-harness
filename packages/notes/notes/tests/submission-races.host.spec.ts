/**
 * Concurrent edits and submission share the durable material's write order.
 *
 * An analysis resolves its conversation's Agent before it claims the material,
 * so the claim is not what a caller racing it is ordered against: whichever of
 * the two reaches the material's write queue first decides, and the loser sees
 * the record the winner left.
 */
import { afterEach, expect, it, vi } from 'vitest'
import { Analysis } from '../src/analysis.ts'
import { NotesRemote } from '../src/remote.ts'
import { bench, material, noteSession, sessionId } from './bench.ts'
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

it('refuses an edit made after the first analysis claimed its material', async () => {
  const p = await subject()
  const analysis = await p.ctx.notesAnalysis.analyse(p.id)
  const edit = await p.ctx.notes.materialUpdate({ id: p.id, text: 'edited body' })
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

it('refuses an edit whose own write lost the race to the analysis claim', async () => {
  const p = await subject()
  const write = p.materials.update.bind(p.materials)
  // The analysis claims the material while the edit is on its way to the
  // table: the edit's own write then reads a record that already entered its
  // conversation and leaves it alone, which is what the caller is told.
  vi.spyOn(p.materials, 'update').mockImplementationOnce(async (material, transform) => {
    await p.ctx.notesAnalysis.analyse(p.id)
    return await write(material, transform)
  })

  const edit = await p.ctx.notes.materialUpdate({ id: p.id, text: 'edited body' })

  expect(edit).toEqual({ ok: false, error: { code: 'material-submitted', id: p.id } })
  expect(p.materials.get(p.id)?.text).toBe('original body')
  expect(p.materials.get(p.id)?.status).toBe('analyzing')
})

it('submits the body an edit supplied while the conversation was loaded again', async () => {
  const current = await bench()
  mounted = current
  await current.ctx.plugin(Analysis).await()
  await current.ctx.plugin(NotesRemote).await()
  // A conversation this process does not hold: the analysis spends the load
  // before it can claim the material, and an edit landing in that window is
  // the body the claim composes from.
  const noteId = await current.sessions.record(noteSession({ sessionId: sessionId('dsh-cold') }))
  const id = await current.materials.create(material({ noteId, text: 'original body' }))

  const [edit, analysis] = await Promise.all([
    current.ctx.notes.materialUpdate({ id, text: 'edited body' }),
    current.ctx.notesAnalysis.analyse(id),
  ])

  expect(edit).toEqual({ ok: true, value: { applied: true } })
  expect(analysis).toBeNull()
  expect(current.agents.resumed).toHaveLength(1)
  expect(current.agents.followup.mock.calls[0]?.[0]).toMatchObject({
    content: [{ type: 'text', text: 'edited body' }],
  })
  expect(current.materials.get(id)?.text).toBe('edited body')
})
