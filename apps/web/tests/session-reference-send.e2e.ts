// Web e2e scenario: the complete session-reference send chain. The browser
// inserts a chip, the submit serializes the canonical mention, the prompt RPC
// carries it unchanged, host admission records the readable direct message,
// and the model request (replayed keylessly) consumes its recall snapshot.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMessage, createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import { encodeSessionReferenceUri } from '@deepseek-ai/dsh-session-reference'
import type {} from '@deepseek-ai/dsh-session-title'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const CURRENT_ID = 'web-session-reference-send-current'
const SOURCE_ID = 'web-session-reference-send-source'
const DONE = 'SESSION_REFERENCE_SEND_OK'

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** One settled, titled conversation in the scaffold workspace. */
function conversationFixture(id: string, title: string, text: string): string {
  const session = Session.create(SessionId(id))
  const origin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title,
    messageSeqs: [user.seq],
    source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: `${title} done` }],
      source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return [
    JSON.stringify({
      type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}',
      createdAt: 0, cwd: '{{cwd}}',
    }),
    ...session.events.map(event => JSON.stringify({ ...event, time: origin + event.seq * 1_000 })),
    '',
  ].join('\n')
}

describe('web e2e: session-reference chip to model request', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let replayDir: string | undefined

  beforeAll(async () => {
    replayDir = await mkdtemp(join(tmpdir(), 'dsh-session-reference-send-replay-'))
    const override: ReplayEntry[] = [{ kind: 'chunks', chunks: textResponse(DONE) }]
    const replayOverride = join(replayDir, 'replay.override.json')
    await writeFile(replayOverride, JSON.stringify(override))
    scaffold = await launchWebScaffold({
      replayFixture: join(replayDir, 'override-only.jsonl'),
      replayOverride,
      replayContextWindow: 128_000,
    })
    await seedSession(scaffold, conversationFixture(CURRENT_ID, 'Current send', 'current user'), CURRENT_ID)
    await seedSession(scaffold, conversationFixture(SOURCE_ID, 'Handoff send', 'source user'), SOURCE_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    if (replayDir !== undefined) await rm(replayDir, { recursive: true, force: true })
  })

  it('submits a picked session and records the direct message before its recall snapshot', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-session-reference-send'))

    const listing = await scaffold.ctx.apiProxy.sessions.list({
      rpcId: 'web-session-reference-send-list' as never,
      payload: {},
    })
    if (!listing.result.ok) throw new Error(`session.list failed: ${listing.result.error.message}`)
    const items = listing.result.value.items
    const currentIndex = items.findIndex(item => item.sessionId === CURRENT_ID)
    expect(currentIndex).toBeGreaterThanOrEqual(0)
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    if (await groupRow.getAttribute('aria-expanded') !== 'true') await groupRow.click()
    const currentRow = page.locator('[role="treeitem"]').nth(1 + currentIndex)
    await currentRow.waitFor({ timeout: 10_000 })
    await currentRow.click()

    const composer = page.locator('textarea:enabled').last()
    await composer.click()
    await composer.pressSequentially('@')
    const menu = page.locator('[role="listbox"]')
    await menu.waitFor({ timeout: 10_000 })
    const option = menu.getByRole('option', { name: /Session · Handoff send/ })
    await option.waitFor({ timeout: 5_000 })
    await option.click()
    await composer.pressSequentially(' 请继续')
    const promptRequest = page.waitForRequest(request =>
      request.method() === 'POST' && new URL(request.url()).pathname === '/api/session.prompt')
    await composer.press('Enter')
    const prompt = await promptRequest
    const promptBody = prompt.postDataJSON() as { payload?: { content?: Array<{ type: string; text?: string }> } }
    const promptParts = promptBody.payload?.content ?? []
    const promptText = promptParts.flatMap(part => part.type === 'text' && part.text !== undefined ? [part.text] : []).join('\n')
    expect(promptText).toContain(encodeSessionReferenceUri(SessionId(SOURCE_ID)))

    await expect.poll(() => page.getByText(DONE, { exact: true }).count(), { timeout: 15_000 }).toBe(1)

    const agent = scaffold.ctx.agents.get(SessionId(CURRENT_ID))
    expect(agent).toBeDefined()
    const userMessages = agent!.session.events.flatMap(event =>
      event.type === 'user/message' ? [event.data] : [])
    const snapshotIndex = userMessages.findIndex(message => message.source.kind === 'session-reference')
    const directIndex = userMessages.findLastIndex(message => message.source.kind === 'user')
    expect(snapshotIndex).toBeGreaterThanOrEqual(0)
    expect(snapshotIndex).toBe(directIndex + 1)
    const directText = userMessages[directIndex]!.content
      .flatMap(block => block.type === 'text' ? [block.text] : [])
      .join('\n')
    expect(directText).toContain('请继续')
    expect(directText).not.toContain('dsh-session:')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
