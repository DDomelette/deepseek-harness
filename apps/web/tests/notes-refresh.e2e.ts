/** A recorded model turn settles while the notes panel holds an older listing. */
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { chromium } from 'playwright'
import type { Browser } from 'playwright'
import { afterEach, expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-notes'
import {
  captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, seedSession, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/fresh-round-trip/session.v3.jsonl', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/notes-refresh/settled.expected.md', import.meta.url))
const MODE = webSnapshotMode()
let scaffold: WebScaffold | undefined
let browser: Browser | undefined
let releaseListing = (): void => {}

afterEach(async () => {
  releaseListing()
  try {
    await browser?.close()
  } finally {
    await scaffold?.close()
    browser = undefined
    scaffold = undefined
  }
})

it.skipIf(MODE === 'record')('refreshes a note settled during an older listing without another click', async () => {
  // The shared recording owns its Session golden; this consumer snapshots the
  // notes projection, whose plugin-attributed input differs from a chat prompt.
  scaffold = await launchWebScaffold({ replayFixture: FIXTURE, compareReplaySession: false })
  const recorded = await readFile(FIXTURE, 'utf8')
  await seedSession(scaffold, recorded, 'notes-source-session')
  browser = await chromium.launch()
  const page = await newEnglishPage(browser)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.getByRole('treeitem').first().click()
  await page.getByRole('treeitem').nth(1).click()
  await page.getByRole('button', { name: 'Open the notes panel', exact: true }).waitFor()
  const notes = scaffold.ctx.notes
  expect(await notes.settingsUpdate({ workspace: scaffold.workspaceCwd, strategy: 'manual' })).toEqual({
    ok: true, value: { applied: true },
  })
  const created = await notes.sessionCreate()
  if (!created.ok) throw new Error(created.error.code)
  const note = scaffold.ctx.notesSessions.get(created.value.id)!
  const added = await notes.materialAddText({
    noteId: created.value.id, text: 'Draft passage', action: null,
    source: { sessionId: note.sessionId, view: 'chat', seq: null, messageId: null, callId: null, label: 'Saved passage' },
  })
  if (!added.ok) throw new Error(added.error.code)
  await page.getByRole('button', { name: 'Open the notes panel', exact: true }).click()
  const panel = page.locator('[data-notes-panel]')
  await panel.locator('[data-notes-select]').click()
  const [prompt] = fixtureUserPrompts(recorded)
  if (prompt === undefined) throw new Error('shared recording contains no prompt')
  await panel.locator('[data-notes-editor]').fill(prompt)
  await panel.locator('[data-notes-save]').click()
  await expect.poll(() => scaffold!.ctx.notesMaterials.get(added.value.id)?.text).toBe(prompt)
  await page.locator('[data-notes-panel]:not([data-notes-loading])').waitFor()

  const held = Promise.withResolvers<undefined>()
  const captured = Promise.withResolvers<undefined>()
  releaseListing = () => { held.resolve(undefined) }
  let delayed = false
  await page.route('**/api/notes/materialList', async (route) => {
    if (delayed) { await route.continue(); return }
    delayed = true
    const response = await route.fetch()
    captured.resolve(undefined)
    await held.promise
    await route.fulfill({ response })
  })
  await panel.getByRole('button', { name: 'Refresh', exact: true }).click()
  await captured.promise
  const settled = scaffold.whenTurnSettled()
  await panel.locator('[data-notes-analyze]').click()
  await settled
  await expect.poll(() => scaffold!.ctx.notesMaterials.get(added.value.id)?.status).toBe('analyzed')
  releaseListing()
  await panel.locator('[data-notes-detail] [data-notes-status="analyzed"]').waitFor()
  await panel.getByText('DONE', { exact: true }).waitFor()
  expect(await panel.locator('[data-notes-editor]').count()).toBe(0)
  expect(await panel.locator('[data-notes-analyze]').count()).toBe(0)
  await mkdir(dirname(EXPECTED), { recursive: true })
  const snapshot = await captureStableAria(page, '[data-notes-panel]', scaffold.workspaceCwd)
  await compareOrRefreshGolden(EXPECTED, snapshot, MODE)
})
