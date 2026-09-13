// Handset-viewport coverage for the drawer sidebar, the fitted content width
// axis, and composer usability at 390px: the official roster, one Chromium,
// touch emulation. See sidebar-right.e2e.ts for the scaffold pattern.
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newMobilePage, requireDist } from './support.ts'

describe('mobile viewport (390×844, touch)', () => {
  let browser: Browser
  let scaffold: WebScaffold
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    requireDist()
    browser = await chromium.launch()
    scaffold = await launchWebScaffold()
    page = await newMobilePage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  }, 120_000)

  afterAll(async () => {
    await page?.context().close()
    await scaffold?.close()
    await browser?.close()
  })

  it('keeps the document within the viewport (no horizontal overflow)', async () => {
    await expect.poll(async () => await page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? 0)).toBeGreaterThan(1000)
    const metrics = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }))
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.inner)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('opens and closes the sidebar as a drawer', async () => {
    const frame = page.locator('[class*="frame"]').first()
    const scrim = page.locator('[data-drawer-scrim]')
    // Resting state: the rail form, no scrim.
    await page.getByRole('button', { name: 'Open sidebar' }).waitFor({ state: 'visible' })
    expect(await scrim.count()).toBe(0)
    await page.getByRole('button', { name: 'Open sidebar' }).click()
    // Drawer open: the sidebar floats over the center, the track keeps the 56px
    // rail, and the scrim appears.
    await scrim.waitFor({ state: 'attached' })
    expect(await scrim.count()).toBe(1)
    await expect.poll(async () => await frame.getAttribute('data-drawer')).toBe('true')
    await expect.poll(async () => {
      const columns = await frame.evaluate(el => getComputedStyle(el).gridTemplateColumns)
      return columns.startsWith('56px')
    }).toBe(true)
    // No horizontal overflow with the drawer open.
    const metrics = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }))
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.inner)
    // A scrim tap closes the drawer. The open panel (280px, above the scrim in
    // z-order) covers the scrim's centre, so tap the exposed strip at the
    // right edge like a user would.
    await scrim.tap({ position: { x: 370, y: 422 } })
    await scrim.waitFor({ state: 'detached' })
    // Reopen; Escape closes it.
    await page.getByRole('button', { name: 'Open sidebar' }).click()
    await scrim.waitFor({ state: 'attached' })
    await page.keyboard.press('Escape')
    await scrim.waitFor({ state: 'detached' })
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps the composer visible inside the viewport', async () => {
    const composer = page.locator('[class*="composerSeat"]').first()
    await composer.waitFor({ state: 'visible' })
    const box = await composer.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y + box!.height).toBeLessThanOrEqual(844)
    expect(box!.width).toBeLessThanOrEqual(390)
    expect(tripwire.pageErrors).toEqual([])
  })
})
