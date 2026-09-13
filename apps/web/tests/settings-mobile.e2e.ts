// Web e2e scenario: the settings shell at a handset viewport. Below the
// single-pane breakpoint the panel fills the screen and shows one pane at a
// time — the section list first, then the chosen section with a way back — so
// the section content keeps a readable column instead of the character-wide
// strip a phone-width two-column split leaves it.
// Zero model calls: the settings shell is pure client state on a blank frame,
// so there is no fixture and a stray stream would fail loud on the open llm
// seam.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

/** A handset viewport: below the panel's 768px single-pane breakpoint. */
const HANDSET = { width: 390, height: 844 }
/** The viewport the two-column layout is specified for. */
const DESKTOP = { width: 1680, height: 1000 }

describe('web e2e: settings at a handset viewport', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: HANDSET, locale: ZH_BROWSER_LOCALE, timezoneId: 'Asia/Shanghai' })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('lists the sections, opens one on its own pane, and returns to the list', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-handset'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })

    // The panel opens on the list pane, which fills the handset: the row is a
    // full-width target, not the 164px cell of the two-column layout, and the
    // section content is off screen.
    expect(await dialog.getAttribute('data-pane')).toBe('list')
    const row = dialog.getByRole('button', { name: '通用设置' })
    expect((await row.boundingBox())?.width ?? 0).toBeGreaterThan(HANDSET.width * 0.6)
    expect(await dialog.getByText('语言', { exact: true }).isVisible()).toBe(false)
    // Nothing spills sideways out of the viewport.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(0)

    // A row tap opens that section alone, named in the header beside the back
    // control, and the content column keeps most of the handset width.
    await row.click()
    await expect.poll(async () => await dialog.getAttribute('data-pane')).toBe('detail')
    const back = dialog.getByRole('button', { name: '返回' })
    await back.waitFor({ timeout: 5_000 })
    expect(await dialog.locator('[data-detail-title]').textContent()).toBe('通用设置')
    const options = dialog.locator('[class*="options"]')
    expect((await options.boundingBox())?.width ?? 0).toBeGreaterThan(HANDSET.width * 0.7)
    await expect.poll(async () => await options.getByText('语言', { exact: true }).isVisible()).toBe(true)

    // Back returns to the list without closing the dialog; the close control
    // then leaves both.
    await back.click()
    await expect.poll(async () => await dialog.getAttribute('data-pane')).toBe('list')
    await dialog.getByRole('button', { name: '关闭' }).click()
    await expect.poll(async () => await dialog.count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps both columns on a desktop viewport and offers no back control there', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-desktop'))
    await page.setViewportSize(DESKTOP)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })

    // The nav cell is back to its rail width while the section content stays on
    // screen beside it, and the single-pane back control is not offered.
    const row = dialog.getByRole('button', { name: '通用设置' })
    expect((await row.boundingBox())?.width ?? 0).toBeLessThan(200)
    await expect.poll(async () => await dialog.getByText('语言', { exact: true }).isVisible()).toBe(true)
    expect(await dialog.getByRole('button', { name: '返回' }).isVisible()).toBe(false)

    await dialog.getByRole('button', { name: '模型' }).click()
    await expect.poll(async () => await dialog.getByRole('button', { name: '模型' }).isVisible()).toBe(true)
    expect(await dialog.locator('[data-detail-title]').textContent()).toBe('模型')
    await dialog.getByRole('button', { name: '关闭' }).click()
    await expect.poll(async () => await dialog.count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  })
})
