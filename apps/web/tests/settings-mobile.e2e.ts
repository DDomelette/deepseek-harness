// Web e2e scenario: the settings shell at a handset viewport, touch-emulated so
// the coarse-pointer rules are live. Below the single-pane breakpoint the panel
// fills the screen and shows one pane at a time — the section list first, then
// the chosen section with a way back — so the section content keeps a readable
// column instead of the character-wide strip a phone-width two-column split
// leaves it.
// Zero model calls: the settings shell is pure client state on a blank frame,
// so there is no fixture and a stray stream would fail loud on the open llm
// seam.
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

/** A handset viewport: below the panel's 768px single-pane breakpoint. */
const HANDSET = { width: 390, height: 844 }
/** The viewport the two-column layout is specified for. */
const DESKTOP = { width: 1680, height: 1000 }

/**
 * Assert that every native select the open settings dialog renders clears the
 * 44px touch-target floor. A pane that renders none fails here rather than
 * passing without measuring anything.
 * @param dialog - the open settings dialog.
 */
async function expectSelectTouchTargets(dialog: Locator): Promise<void> {
  const selects = dialog.locator('select')
  const count = await selects.count()
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    const height = (await selects.nth(index).boundingBox())?.height ?? 0
    expect(height, `select ${String(index)}`).toBeGreaterThanOrEqual(44)
  }
}

describe('web e2e: settings at a handset viewport', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    // Touch emulation is the coarse pointer every 44px target rule is written
    // under, and only a context can set it.
    const context = await browser.newContext({
      viewport: HANDSET,
      hasTouch: true,
      locale: ZH_BROWSER_LOCALE,
      timezoneId: 'Asia/Shanghai',
    })
    page = await context.newPage()
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
    // The sheet spans the raw viewport: this browser reports no notch, so every
    // safe-area inset the sheet asks for resolves to no padding.
    expect(await dialog.boundingBox()).toEqual({ x: 0, y: 0, ...HANDSET })
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

    // Detail header on one bar: back + title + document action + close. The
    // action trades its label for a glyph (accessible name unchanged) so the
    // pill no longer squeezes the section title.
    const docAction = dialog.getByRole('button', { name: '打开配置文件' })
    expect((await docAction.boundingBox())?.width ?? 999).toBeLessThan(60)
    expect((await docAction.innerText()).trim()).toBe('')

    // Appearance: three compact segments on ONE row, not a stack of
    // full-width cards.
    const cubeBoxes = (await Promise.all(
      ['浅色', '深色', '跟随系统'].map(async name => await dialog.getByRole('button', { name }).boundingBox()),
    )).map((box) => {
      if (box === null) throw new Error('appearance cube is unavailable')
      return box
    })
    expect(cubeBoxes).toHaveLength(3)
    const cubeYs = cubeBoxes.map(box => box.y)
    expect(Math.max(...cubeYs) - Math.min(...cubeYs)).toBeLessThan(1)
    for (const box of cubeBoxes) expect(box.height).toBeLessThan(80)

    // Permission: the description keeps the full row and the selector drops
    // to its own line below it.
    const description = await dialog.getByText('选择新会话的默认权限模式').boundingBox()
    const selector = await dialog.getByRole('button', { name: /仅可查看|工作区内修改|完全权限/ }).boundingBox()
    expect(description).not.toBeNull()
    expect(selector).not.toBeNull()
    expect(selector!.y).toBeGreaterThanOrEqual(description!.y + description!.height - 0.5)

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
    // The two-column header keeps the document action's full label.
    expect((await dialog.getByRole('button', { name: '打开配置文件' }).innerText()).trim()).toBe('打开配置文件')

    await dialog.getByRole('button', { name: '模型' }).click()
    await expect.poll(async () => await dialog.getByRole('button', { name: '模型' }).isVisible()).toBe(true)
    expect(await dialog.locator('[data-detail-title]').textContent()).toBe('模型')
    await dialog.getByRole('button', { name: '关闭' }).click()
    await expect.poll(async () => await dialog.count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('gives every select the settings pages render a 44px touch target', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-touch-targets'))
    await page.setViewportSize(HANDSET)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })

    // Models: the provider picker exists only inside the add card, so the pane
    // is opened the way the Models scenario opens it.
    await dialog.getByRole('button', { name: '模型' }).click()
    const add = dialog.getByRole('button', { name: '添加提供方' })
    await add.waitFor({ timeout: 10_000 })
    await expect.poll(async () => add.isEnabled(), { timeout: 10_000 }).toBe(true)
    await add.click()
    await dialog.getByLabel('提供方').waitFor({ timeout: 10_000 })
    await expectSelectTouchTargets(dialog)

    // The plugin inventory is one tab into the Plugins section; the preset
    // switcher appears with the same snapshot the group picker renders from.
    await dialog.getByRole('button', { name: '返回' }).click()
    await dialog.getByRole('button', { name: '插件', exact: true }).click()
    await dialog.getByRole('tab', { name: '插件列表', exact: true }).click()
    await dialog.getByRole('button', { name: '选择要查看的 Agent 预设' }).waitFor({ timeout: 10_000 })
    await expectSelectTouchTargets(dialog)

    await dialog.getByRole('button', { name: '关闭' }).click()
    await expect.poll(async () => await dialog.count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  })
})
