/** Cold history retains Chat spacing through the flow slot's display:contents anchor. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, seedSession, selectedSessionFixture, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, newMobilePage, revealNavigationDrawer, saveFailureShot, writeComposerDraft } from './support.ts'

it.each(['turn-tail-actions', 'goal-multi-turn-actions', 'present'] as const)(
  'preserves process and answer spacing in cold %s history', async (scenario) => {
    const scaffold = await launchWebScaffold({})
    onTestFinished(() => scaffold.close())
    if (scenario === 'present') {
      await writeFile(join(scaffold.workspaceCwd, 'report.txt'), 'DELIVERED_REPORT\n')
      await writeFile(join(scaffold.workspaceCwd, '说明.txt'), 'DELIVERED_NOTE\n')
    }
    const fixture = await selectedSessionFixture(fileURLToPath(
      new URL(`../../../snapshots/web/${scenario}/session.v3.jsonl`, import.meta.url),
    ))
    await seedSession(scaffold, await readFile(fixture, 'utf8'), `flow-layout-${scenario}`)
    const browser = await chromium.launch()
    onTestFinished(() => browser.close())
    const page = await newEnglishPage(browser)
    const console = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[role="treeitem"]').first().click()
    await page.locator('[role="treeitem"]').nth(1).click()
    const controls = page.locator('[data-turn-process]')
    await expect.poll(() => controls.count()).toBe(scenario === 'goal-multi-turn-actions' ? 2 : 1)
    const process = controls.first()
    expect(await process.getAttribute('aria-expanded')).toBe('false')
    expect(await process.evaluate(element => element.closest('[data-slot="conversation.chat.flow"]') !== null)).toBe(true)

    if (scenario === 'goal-multi-turn-actions') {
      const trigger = page.locator('[data-turn-trigger]').first()
      await process.click()
      for (const fontSize of [10, 14, 22]) {
        await scaffold.ctx.settings.update('ui-theme', { fontSize })
        await expect.poll(() => page.evaluate(() => document.body.style.getPropertyValue('--dsh-content-font-size')))
          .toBe(`${String(fontSize)}px`)
        const group = page.locator('[data-process-activity]:visible').first()
        expect(await process.evaluate(element => element.getBoundingClientRect().top))
          .toBe(await trigger.evaluate(element => element.getBoundingClientRect().bottom) + 16)
        expect(await group.evaluate(element => element.getBoundingClientRect().top))
          .toBe(await process.evaluate(element => element.getBoundingClientRect().bottom) + 16)
      }
    } else {
      const answer = page.getByText(scenario === 'present' ? 'PRESENT_DONE' : 'DONE', { exact: true })
      await answer.waitFor()
      const answerBounds = await answer.evaluate((element) => {
        const seat = element.closest('[data-chat-flow-kind="assistant-step"]')
        if (seat === null) throw new Error('final answer has no Chat seat')
        const { top, bottom } = seat.getBoundingClientRect()
        return { top, bottom }
      })
      const processBottom = await process.evaluate(element => element.getBoundingClientRect().bottom)
      // Hidden process rows separate the folded control from the first visible reply, so it keeps the 12px reply gap.
      const lead = scenario === 'present' ? answer : page.getByText('Reading the workspace now.', { exact: true })
      const leadTop = await lead.evaluate((element) => {
        const seat = element.closest('[data-chat-flow-kind="assistant-step"]')
        if (seat === null) throw new Error('first visible reply has no Chat seat')
        return seat.getBoundingClientRect().top
      })
      expect(leadTop).toBe(processBottom + 12)
      if (scenario === 'present') {
        const geometry = await page.locator('[data-presented-files-row]').evaluate((grid) => {
          const root = grid.parentElement
          const tail = root?.closest('[data-turn-tail]')
          const actions = tail?.querySelector('button[aria-label="Copy"]')?.parentElement
          if (root === null || actions == null) throw new Error('presented files have no Turn footer')
          return { top: root.getBoundingClientRect().top, bottom: root.getBoundingClientRect().bottom,
            actionsTop: actions.getBoundingClientRect().top }
        })
        expect(geometry.top - answerBounds.bottom).toBeCloseTo(16, 1)
        expect(geometry.actionsTop - geometry.bottom).toBeCloseTo(20, 1)
      }
    }
    expect(console.pageErrors).toEqual([])
  },
)

it.each(['all', 'final'] as const)('keeps cold %s Assistant replies visible and readable on a handset', async (foldedReplies) => {
  const scaffold = await launchWebScaffold({})
  onTestFinished(() => scaffold.close())
  await scaffold.ctx.settings.update('ui-chat', { transcriptView: 'standard', foldedReplies })
  const fixture = await selectedSessionFixture(fileURLToPath(
    new URL('../../../snapshots/web/turn-tail-actions/session.v3.jsonl', import.meta.url),
  ))
  await seedSession(scaffold, await readFile(fixture, 'utf8'), `flow-layout-handset-${foldedReplies}`)
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newMobilePage(browser)
  onTestFinished(() => saveFailureShot(page, 'web-e2e-handset-assistant-reply'))
  const console = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await revealNavigationDrawer(page, 'en')
  await page.locator('[role="treeitem"]').first().click()
  await page.locator('[role="treeitem"]').nth(1).click()
  const visibleReplies = foldedReplies === 'all' ? ['Reading the workspace now.', 'DONE'] : ['DONE']
  for (const text of visibleReplies) {
    const answer = page.getByText(text, { exact: true })
    await answer.waitFor({ state: 'visible' })
    const presentation = await answer.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const seat = element.closest('[data-chat-flow-kind="assistant-step"]')
      if (seat === null) throw new Error('handset reply has no Chat seat')
      const seatBox = seat.getBoundingClientRect()
      const hit = document.elementFromPoint(box.x + Math.min(box.width / 2, 20), box.y + box.height / 2)
      return {
        width: box.width,
        height: box.height,
        color: style.color,
        background: getComputedStyle(document.body).backgroundColor,
        visible: style.visibility,
        opacity: style.opacity,
        insideSeat: box.top >= seatBox.top && box.bottom <= seatBox.bottom + 1,
        hit: hit !== null && (element === hit || element.contains(hit) || hit.contains(element)),
      }
    })
    expect(presentation.width).toBeGreaterThan(0)
    expect(presentation.height).toBeGreaterThan(0)
    expect(presentation.visible).toBe('visible')
    expect(presentation.opacity).toBe('1')
    expect(presentation.color).not.toBe(presentation.background)
    expect(presentation.insideSeat).toBe(true)
    expect(presentation.hit).toBe(true)
  }
  expect(console.pageErrors).toEqual([])
})

it('keeps a live Assistant reply visible through streaming and settlement on a handset', async () => {
  const scaffold = await launchWebScaffold({
    replayFixture: fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url)),
    paceMs: 10,
    compareReplaySession: false,
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newMobilePage(browser)
  onTestFinished(() => saveFailureShot(page, 'web-e2e-handset-live-assistant-reply'))
  const console = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const input = page.locator('[data-composer-input][contenteditable="true"]')
  const settled = scaffold.whenTurnSettled()
  await writeComposerDraft(page, input, 'Reply with a one-sentence description of event sourcing, then stop.')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  const answer = page.getByText(/Event sourcing is a pattern/)
  await answer.waitFor({ state: 'visible' })
  const streaming = await answer.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return { height: box.height, color: style.color, visibility: style.visibility, opacity: style.opacity }
  })
  expect(streaming.height).toBeGreaterThan(0)
  expect(streaming.color).not.toBe('rgba(0, 0, 0, 0)')
  expect(streaming.visibility).toBe('visible')
  expect(streaming.opacity).toBe('1')
  await settled
  await expect.poll(() => answer.isVisible()).toBe(true)
  expect(await answer.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(0)
  expect(console.pageErrors).toEqual([])
})
