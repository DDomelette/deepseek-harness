// Web e2e scenario: the composer '@' session source. Cold-seeds two ordinary
// conversations in the scaffold workspace, opens the current one, types '@',
// picks the source conversation, and verifies the structured chip landed.
// Zero model calls: the scenario never submits a prompt.
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const CURRENT_ID = 'web-session-reference-current'
const SOURCE_ID = 'web-session-reference-source'

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

describe('web e2e: composer @ session references', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, conversationFixture(CURRENT_ID, 'Current task', 'current user'), CURRENT_ID)
    await seedSession(scaffold, conversationFixture(SOURCE_ID, 'Handoff source', 'source user'), SOURCE_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('lists the workspace conversation, inserts a chip, and never calls the model', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-session-references'))

    // Open the seeded current conversation the same way other seeded-history
    // scenarios do: expand the workspace group and click the list row whose
    // order matches the host session list.
    const listing = await scaffold.ctx.apiProxy.sessions.list({
      rpcId: 'web-session-reference-list' as never,
      payload: {},
    })
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
    await composer.type('@')
    const menu = page.locator('[role="listbox"]')
    await menu.waitFor({ timeout: 10_000 })
    await page.getByText('Sessions', { exact: true }).waitFor({ timeout: 5_000 })
    const options = page.locator('[id^="dsh-slash-option-session-"]')
    await expect.poll(() => options.count()).toBe(1)
    await options.first().click()

    expect(await composer.inputValue()).toContain('\uFFFC')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
